import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

const password='Only-for-automated-tests-47!';
let app, origin, cookie='', readerCookie='', dataDir;
before(async()=>{
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'tiem-chanh-test-'));
  app=createApp({password,dataDir}); await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${app.address().port}`;
});
after(async()=>{await new Promise(resolve=>app.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
async function request(route,{method='GET',body,auth=true,sendOrigin=true,reader=false}={}) {
  const headers={'Content-Type':'application/json'};
  if(sendOrigin) headers.Origin=origin;
  if(auth && cookie) headers.Cookie=cookie;
  if(reader && readerCookie) headers.Cookie=readerCookie;
  const response=await fetch(origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();return {response,value};
}
test('anonymous visitors cannot read or modify admin data',async()=>{
  for(const [route,method] of [['/api/admin/catalog','GET'],['/api/admin/books','POST'],['/api/admin/assets','POST']]) {
    assert.equal((await request(route,{method,body:method==='POST'?{}:undefined,auth:false})).response.status,401);
  }
});
test('admin login rejects wrong credentials and cross origin requests',async()=>{
  assert.equal((await request('/api/admin/login',{method:'POST',body:{username:'owner',password:'wrong'}})).response.status,401);
  assert.equal((await request('/api/admin/login',{method:'POST',body:{username:'owner',password},sendOrigin:false})).response.status,403);
});
test('login uses an HttpOnly SameSite session and permits the owner',async()=>{
  const {response}=await request('/api/admin/login',{method:'POST',body:{username:'owner',password}});
  assert.equal(response.status,200);const header=response.headers.get('set-cookie');
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);cookie=header.split(';')[0];
  assert.equal((await request('/api/admin/catalog')).response.status,200);
});
test('private files, config and source data are not publicly served',async()=>{
  for(const route of ['/.data/catalog.json','/.env','/server.mjs','/.git/config','/data/example-catalog.json','/package.json','/uploads/../../server.mjs']) {
    assert.equal((await fetch(origin+route)).status,404,route);
  }
});
test('catalog never contains full chapter text and GET/HEAD serve safely',async()=>{
  const {response,value}=await request('/api/catalog',{auth:false});readerCookie=response.headers.get('set-cookie').split(';')[0];
  assert.ok(value.books.length);assert.equal(value.books[0].chapterList,undefined);
  assert.ok(value.books[0].chapterNumbers.length);
  const head=await fetch(origin,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.match(head.headers.get('content-security-policy'),/script-src 'self'/);
});
let bookId;
const draft={title:'Truyện thử <script>alert(1)</script>',author:'Tác giả thử',genre:'Kỳ ảo',status:'Đang cập nhật',description:'Tóm tắt',hidden:false};
test('admin creates a story without publishing fake chapters',async()=>{
  const {response,value}=await request('/api/admin/books',{method:'POST',body:draft});
  assert.equal(response.status,200);bookId=value.id;
  assert.equal(value.demo,false);assert.equal(value.chapters,0);
});
const chapter=(number,extra={})=>({number,title:`Chương ${number}`,paragraphs:[{text:'Nội dung <img src=x onerror=alert(1)>',align:'center',bold:true}],hidden:false,...extra});
test('admin publishes formatted chapters; duplicate numbers are rejected',async()=>{
  for(const n of [1,7]) assert.equal((await request(`/api/admin/books/${bookId}/chapters`,{method:'POST',body:chapter(n)})).response.status,200);
  assert.equal((await request(`/api/admin/books/${bookId}/chapters`,{method:'POST',body:chapter(7)})).response.status,409);
  const {value}=await request(`/api/books/${bookId}/chapters/7`,{auth:false,reader:true});
  assert.equal(value.paragraphs[0].align,'center');assert.equal(value.paragraphs[0].bold,true);
});
test('scheduled and hidden chapters are unavailable even with a direct URL',async()=>{
  for(const [number,extra] of [[2,{hidden:true}],[3,{publishAt:'2099-01-01T00:00:00Z'}]]) {
    await request(`/api/admin/books/${bookId}/chapters`,{method:'POST',body:chapter(number,extra)});
    assert.equal((await request(`/api/books/${bookId}/chapters/${number}`,{auth:false})).response.status,404);
  }
  const {value}=await request('/api/catalog',{auth:false,reader:true});
  assert.deepEqual(value.books.find(b=>b.id===bookId).chapterNumbers,[1,7]);
});
test('a repeated chapter read on the same day does not inflate totals',async()=>{
  const first=await request(`/api/books/${bookId}/chapters/1`,{auth:false,reader:true});
  const second=await request(`/api/books/${bookId}/chapters/1`,{auth:false,reader:true});
  assert.equal(first.value.reads,second.value.reads);
});
test('favorite updates are idempotent and persist for the anonymous reader',async()=>{
  const route=`/api/books/${bookId}/favorite`;
  const first=await request(route,{method:'POST',body:{favorite:true},auth:false,reader:true});
  const second=await request(route,{method:'POST',body:{favorite:true},auth:false,reader:true});
  assert.equal(first.value.favoriteCount,1);assert.equal(second.value.favoriteCount,1);
  assert.ok((await request('/api/catalog',{auth:false,reader:true})).value.favorites.includes(bookId));
  assert.equal((await request(route,{method:'POST',body:{favorite:false},auth:false,reader:true})).value.favoriteCount,0);
});
test('hiding a story blocks its chapters; unhiding restores them',async()=>{
  await request(`/api/admin/books/${bookId}`,{method:'PUT',body:{...draft,hidden:true}});
  assert.equal((await request(`/api/books/${bookId}/chapters/1`,{auth:false})).response.status,404);
  assert.ok(!(await request('/api/catalog',{auth:false,reader:true})).value.books.some(b=>b.id===bookId));
  await request(`/api/admin/books/${bookId}`,{method:'PUT',body:draft});
  assert.equal((await request(`/api/books/${bookId}/chapters/1`,{auth:false,reader:true})).response.status,200);
});
test('request validation rejects malformed records, bad enums and impossible values',async()=>{
  assert.equal((await request('/api/admin/books',{method:'POST',body:{...draft,title:''}})).response.status,400);
  assert.equal((await request('/api/admin/books',{method:'POST',body:{...draft,status:'other'}})).response.status,400);
  assert.equal((await request('/api/admin/books',{method:'POST',body:null})).response.status,400);
  assert.equal((await request(`/api/admin/books/${bookId}/chapters`,{method:'POST',body:chapter(-1)})).response.status,400);
  assert.equal((await request(`/api/admin/books/${bookId}/chapters`,{method:'POST',body:chapter(9,{paragraphs:[null]})})).response.status,400);
});
let imageUrl;
test('owner uploads a valid raster asset that is served with its real media type',async()=>{
  const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const {response,value}=await request('/api/admin/assets',{method:'POST',body:{kind:'frame',name:'Khung thử',price:12,data}});
  assert.equal(response.status,201);imageUrl=value.url;
  const img=await fetch(origin+imageUrl);assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
});
test('SVG, executable content and negative asset prices are rejected',async()=>{
  for(const body of [{kind:'avatar',name:'x',price:0,data:'data:image/svg+xml;base64,PHN2Zz4='},{kind:'avatar',name:'x',price:0,data:'data:image/png;base64,SGVsbG8='},{kind:'emoji',name:'x',price:-1,data:'data:image/png;base64,AA=='}])
    assert.equal((await request('/api/admin/assets',{method:'POST',body})).response.status,400);
});
test('catalog and uploaded files survive a server restart',async()=>{
  await new Promise(resolve=>app.close(resolve));app=createApp({password,dataDir});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${app.address().port}`;
  const {value}=await request('/api/catalog',{auth:false,reader:true});assert.ok(value.books.some(b=>b.id===bookId));assert.equal((await fetch(origin+imageUrl)).status,200);
  assert.equal((await request('/api/admin/catalog')).response.status,401);
  const login=await request('/api/admin/login',{method:'POST',body:{username:'owner',password}});cookie=login.response.headers.get('set-cookie').split(';')[0];
});
test('delete removes persisted stories and chapters from public navigation',async()=>{
  assert.equal((await request(`/api/admin/books/${bookId}/chapters/7`,{method:'DELETE'})).response.status,200);
  assert.equal((await request(`/api/books/${bookId}/chapters/7`,{auth:false})).response.status,404);
  assert.equal((await request(`/api/admin/books/${bookId}`,{method:'DELETE'})).response.status,200);
  assert.equal((await request(`/api/books/${bookId}/chapters/1`,{auth:false})).response.status,404);
});
test('logout invalidates the session on the server',async()=>{
  assert.equal((await request('/api/admin/logout',{method:'POST',body:{}})).response.status,200);
  assert.equal((await request('/api/admin/catalog')).response.status,401);
});
