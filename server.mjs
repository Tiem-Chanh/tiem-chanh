import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { publishedChapters } from './core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 3 * 1024 * 1024;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };
class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status,message) => { throw new RequestError(status,message); };
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400,'Nội dung không hợp lệ hoặc quá dài.');
  return value.trim();
};
const integer = (value,min,max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400,'Giá trị số không hợp lệ.');
  return value;
};
function imageType(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))) return 'gif';
  if (buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'webp';
  fail(400,'Chỉ nhận ảnh PNG, JPEG, GIF hoặc WebP hợp lệ.');
}

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(ROOT,'.data'));
  fs.mkdirSync(path.join(dataDir,'uploads'),{recursive:true});
  const dbPath = path.join(dataDir,'catalog.json');
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath,'utf8')) :
    { ...JSON.parse(fs.readFileSync(path.join(ROOT,'data/example-catalog.json'),'utf8')), visitors:{} };
  db.visitors ||= {};
  const persist = () => {
    fs.writeFileSync(dbPath+'.tmp', JSON.stringify(db));
    fs.renameSync(dbPath+'.tmp',dbPath);
  };
  const password = options.password ?? process.env.ADMIN_PASSWORD ?? '';
  const username = options.username ?? process.env.ADMIN_USER ?? 'owner';
  if (password && (password.length < 12 || password.length > 256)) throw new Error('ADMIN_PASSWORD phải có từ 12 đến 256 ký tự.');
  const salt = randomBytes(32), passwordHash = password ? scryptSync(password,salt,64) : null;
  const sessions = new Map(), limits = new Map();
  const publicOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN || '';
  if (publicOrigin && !/^https?:\/\/[^/]+$/.test(publicOrigin)) throw new Error('PUBLIC_ORIGIN phải là origin HTTP/HTTPS, không có đường dẫn.');
  function limit(key,max,windowMs) {
    const now = Date.now();
    if (limits.size > 10000) for (const [id,item] of limits) if (now >= item.until) limits.delete(id);
    let entry = limits.get(key);
    if (!entry || now >= entry.until) limits.set(key,entry={count:0,until:now+windowMs});
    if (++entry.count > max) fail(429,'Thao tác quá nhanh. Vui lòng thử lại sau.');
  }
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
  function setCookie(req,res,name,value,maxAge) {
    const secure = publicOrigin.startsWith('https:') || req.socket.encrypted;
    res.setHeader('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function requireAdmin(req) {
    const token = cookies(req).chanh_admin;
    const session = sessions.get(token);
    if (!session || Date.now() >= session.until) { sessions.delete(token); fail(401,'Vui lòng đăng nhập quản trị.'); }
  }
  function visitor(req,res) {
    let id = cookies(req).chanh_reader;
    if (!/^[a-f0-9]{48}$/.test(id || '') || !db.visitors[id]) {
      id = randomBytes(24).toString('hex');
      db.visitors[id] = { favorites:[], views:{}, lastSeen:Date.now() };
      // Expire anonymous records after 180 days to bound persisted state.
      for (const [key,item] of Object.entries(db.visitors)) if (Date.now()-item.lastSeen > 180*86400000) delete db.visitors[key];
      setCookie(req,res,'chanh_reader',id,180*86400);
    }
    db.visitors[id].lastSeen = Date.now();
    return db.visitors[id];
  }
  function publicBook(book) {
    const chapters = publishedChapters(book);
    const chapterNumbers = book.demo ? Array.from({length:book.chapters},(_,i)=>i+1) : chapters.map(ch=>ch.number);
    const { chapterList, ...rest } = book;
    const lastPublishedAt=chapters.reduce((latest,ch)=>Math.max(latest,Date.parse(ch.publishAt || ch.updatedAt || book.createdAt) || 0),0);
    return { ...rest, chapters:chapterNumbers.length, chapterNumbers, lastPublishedAt };
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'Yêu cầu JSON.');
    if (Number(req.headers['content-length']) > MAX_BODY) fail(413,'Dữ liệu quá lớn.');
    let bytes = 0, chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) fail(413,'Dữ liệu quá lớn.'); chunks.push(chunk); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(400,'JSON không hợp lệ.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'Yêu cầu một đối tượng JSON.');
    return value;
  }
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url,'http://localhost');
      let route;
      try { route=decodeURIComponent(url.pathname); } catch { fail(400,'Đường dẫn không hợp lệ.'); }
      const ip = req.socket.remoteAddress;
      if (route.startsWith('/api/')) {
        limit('api:'+ip,600,60_000);
        if (!['GET','POST','PUT','DELETE'].includes(req.method)) fail(405,'Phương thức không hỗ trợ.');
        if (req.method !== 'GET') {
          const expected = publicOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
          if (req.headers.origin !== expected) fail(403,'Nguồn yêu cầu không hợp lệ.');
        }
        if (route === '/api/admin/login' && req.method === 'POST') {
          if (!passwordHash) fail(503,'Quản trị chưa được cấu hình. Hãy đặt ADMIN_PASSWORD trên máy chủ.');
          limit('login:'+ip,10,15*60_000);
          const input = await body(req);
          const provided = text(input.password,256);
          const valid = timingSafeEqual(scryptSync(provided,salt,64),passwordHash);
          if (input.username !== username || !valid) fail(401,'Tên đăng nhập hoặc mật khẩu không đúng.');
          for (const [key,session] of sessions) if (Date.now()>=session.until) sessions.delete(key);
          if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
          const token = randomBytes(32).toString('hex'); sessions.set(token,{until:Date.now()+8*3600000});
          setCookie(req,res,'chanh_admin',token,8*3600);
          return json(res,200,{username});
        }
        if (route.startsWith('/api/admin/')) {
          requireAdmin(req);
          if (route === '/api/admin/logout' && req.method === 'POST') {
            sessions.delete(cookies(req).chanh_admin); setCookie(req,res,'chanh_admin','',0);
            return json(res,200,{ok:true});
          }
          if (route === '/api/admin/catalog' && req.method === 'GET') return json(res,200,{books:db.books,assets:db.assets,username});
          if (route === '/api/admin/assets' && req.method === 'POST') {
            const input = await body(req);
            if (!['avatar','frame','emoji','cover'].includes(input.kind)) fail(400,'Loại tài nguyên không hợp lệ.');
            const name = text(input.name,80), price = integer(input.price ?? 0,0,1_000_000);
            if (typeof input.data !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.data)) fail(400,'Ảnh không hợp lệ.');
            const buffer = Buffer.from(input.data.split(',')[1],'base64');
            if (!buffer.length || buffer.length > 2*1024*1024) fail(413,'Ảnh phải nhỏ hơn hoặc bằng 2 MB.');
            const ext = imageType(buffer), id = randomUUID(), file = `${id}.${ext}`;
            fs.writeFileSync(path.join(dataDir,'uploads',file),buffer);
            const asset = {id,name,kind:input.kind,price,url:'/uploads/'+file};
            db.assets.push(asset); persist(); return json(res,201,asset);
          }
          const bookRoute = route.match(/^\/api\/admin\/books(?:\/([a-zA-Z0-9-]+))?$/);
          if (bookRoute) {
            let book = db.books.find(b=>b.id===bookRoute[1]);
            if (req.method === 'DELETE') {
              if (!book) fail(404,'Không tìm thấy truyện.');
              db.books = db.books.filter(b=>b!==book); persist(); return json(res,200,{ok:true});
            }
            if (req.method === 'POST' || req.method === 'PUT') {
              if ((req.method === 'PUT' && !book) || (req.method === 'POST' && bookRoute[1])) fail(404,'Không tìm thấy truyện.');
              const input = await body(req);
              const value = {title:text(input.title,160),author:text(input.author,100),genre:text(input.genre,60),
                description:text(input.description,10000,false),status:input.status,hidden:input.hidden === true,
                rawSource:text(input.rawSource || '',200,false),tags:text(input.tags || '',300,false)};
              if (!['Hoàn thành','Đang cập nhật'].includes(value.status)) fail(400,'Trạng thái không hợp lệ.');
              const cover = input.cover || '';
              if (cover && !db.assets.some(a=>a.kind==='cover' && a.url===cover)) fail(400,'Ảnh bìa không hợp lệ.');
              value.cover = cover;
              if (!book) {
                book={id:randomUUID(),demo:false,chapters:0,chapterList:[],reads:0,favoriteCount:0,rating:'—',bg:'#a9c1ba',ink:'#253e3d',createdAt:new Date().toISOString()};
                db.books.push(book);
              }
              Object.assign(book,value); persist(); return json(res,200,book);
            }
          }
          const chapterRoute = route.match(/^\/api\/admin\/books\/([a-zA-Z0-9-]+)\/chapters(?:\/(\d+))?$/);
          if (chapterRoute) {
            const book = db.books.find(b=>b.id===chapterRoute[1]);
            if (!book || book.demo) fail(400,'Hãy tạo truyện thật để quản lý chương; truyện mẫu chỉ dùng xem thử.');
            const number = chapterRoute[2] ? Number(chapterRoute[2]) : null;
            const chapter = book.chapterList.find(ch=>ch.number===number);
            if (req.method === 'DELETE') {
              if (!chapter) fail(404,'Không tìm thấy chương.');
              book.chapterList=book.chapterList.filter(ch=>ch!==chapter); persist(); return json(res,200,{ok:true});
            }
            if (['PUT','POST'].includes(req.method)) {
              if (req.method === 'PUT' && !chapter) fail(404,'Không tìm thấy chương.');
              const input = await body(req);
              const chapterNumber = integer(input.number,1,100000);
              if (book.chapterList.some(ch=>ch.number===chapterNumber && ch!==chapter)) fail(409,'Số chương đã tồn tại.');
              if (!Array.isArray(input.paragraphs) || !input.paragraphs.length || input.paragraphs.length>2000) fail(400,'Nội dung chương không hợp lệ.');
              const paragraphs = input.paragraphs.map(p=>({text:text(p?.text,20000),align:['left','center','right','justify'].includes(p?.align)?p.align:'left',bold:p?.bold===true,italic:p?.italic===true,underline:p?.underline===true}));
              if (paragraphs.reduce((n,p)=>n+p.text.length,0)>300000) fail(400,'Chương quá dài.');
              let publishAt = input.publishAt || null;
              if (publishAt && !Number.isFinite(Date.parse(publishAt))) fail(400,'Thời gian đăng không hợp lệ.');
              const value={number:chapterNumber,title:text(input.title,200),paragraphs,hidden:input.hidden===true,publishAt,updatedAt:new Date().toISOString()};
              if (chapter) Object.assign(chapter,value); else book.chapterList.push(value);
              book.chapters=book.chapterList.length; persist(); return json(res,200,value);
            }
          }
          fail(404,'Không tìm thấy thao tác.');
        }
        if (route === '/api/catalog' && req.method === 'GET') {
          const reader=visitor(req,res); persist();
          return json(res,200,{books:db.books.filter(b=>!b.hidden).map(publicBook),assets:db.assets.filter(a=>a.kind!=='cover'),favorites:reader.favorites});
        }
        const favoriteRoute=route.match(/^\/api\/books\/([a-zA-Z0-9-]+)\/favorite$/);
        if (favoriteRoute && req.method==='POST') {
          const book=db.books.find(b=>b.id===favoriteRoute[1] && !b.hidden);
          if (!book) fail(404,'Không tìm thấy truyện.');
          const input=await body(req); if(typeof input.favorite!=='boolean') fail(400,'Trạng thái yêu thích không hợp lệ.');
          const reader=visitor(req,res), existing=reader.favorites.includes(book.id);
          if (input.favorite!==existing) {
            reader.favorites=input.favorite?[...reader.favorites,book.id]:reader.favorites.filter(id=>id!==book.id);
            book.favoriteCount=Math.max(0,book.favoriteCount+(input.favorite?1:-1)); persist();
          }
          return json(res,200,{favoriteCount:book.favoriteCount,favorite:input.favorite});
        }
        const chapterRoute=route.match(/^\/api\/books\/([a-zA-Z0-9-]+)\/chapters\/(\d+)$/);
        if (chapterRoute && req.method==='GET') {
          const book=db.books.find(b=>b.id===chapterRoute[1] && !b.hidden), number=Number(chapterRoute[2]);
          if (!book) fail(404,'Không tìm thấy truyện.');
          let chapter=publishedChapters(book).find(ch=>ch.number===number);
          if (book.demo && number>=1 && number<=book.chapters) chapter={number,title:'Một ngày thật chậm',demo:true,paragraphs:[
            {text:`Buổi sáng ngày thứ ${number} bắt đầu thật chậm. Nắng nghiêng qua khung cửa của Tiệm Chanh.`,align:'left'},
            {text:`Trên bàn là cuốn “${book.title}”. Giữa hai trang giấy, ai đó đã đặt một chiếc lá khô.`,align:'left'},
            {text:'Đây là nội dung mẫu để thử giao diện đọc. Quản trị viên có thể tạo truyện mới và đăng nội dung thật.',align:'left'}]};
          if (!chapter) fail(404,'Chương chưa được đăng hoặc đã được ẩn.');
          const reader=visitor(req,res), key=`${book.id}:${number}`, day=new Date().toISOString().slice(0,10);
          if(reader.views[key]!==day) { book.reads++; reader.views[key]=day; persist(); }
          return json(res,200,{...chapter,reads:book.reads});
        }
        fail(404,'Không tìm thấy API.');
      }
      if (!['GET','HEAD'].includes(req.method)) fail(405,'Phương thức không hỗ trợ.');
      let file;
      if (route==='/admin' || route==='/admin/') file=path.join(ROOT,'admin.html');
      else if (['/','/index.html','/index.css','/app.js','/core.mjs','/admin.js','/admin.css'].includes(route)) file=path.join(ROOT,route==='/'?'index.html':route.slice(1));
      else if (route.startsWith('/public/assets/')) {
        file=path.resolve(ROOT,'.'+route);
        if(!file.startsWith(path.join(ROOT,'public','assets')+path.sep)) fail(403,'Đường dẫn không hợp lệ.');
      } else if (/^\/uploads\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(route)) file=path.join(dataDir,route.slice(1));
      else fail(404,'Không tìm thấy trang.');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404,'Không tìm thấy tệp.');
      const content=fs.readFileSync(file);
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length':content.length,'Cache-Control':route.startsWith('/uploads/')?'public, max-age=86400':'no-cache'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch (error) {
      if (!res.headersSent) json(res,error.status || 500,{error:error.status ? error.message : 'Lỗi máy chủ. Vui lòng thử lại.'});
      else res.end();
      if(!error.status) console.error(error);
    }
  });
  server.requestTimeout=30000;
  server.headersTimeout=10000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 3000), host=process.env.HOST || '127.0.0.1';
  const app=createApp();
  app.listen(port,host,()=>{
    console.log(`Tiệm Chanh: http://${host}:${port} | Quản trị: /admin`);
    if(!process.env.ADMIN_PASSWORD) console.log('Đặt ADMIN_PASSWORD (ít nhất 12 ký tự) để bật quản trị.');
  });
}
