const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog={books:[],assets:[]}, activeParagraph=null, fileData='', currentBook=null, uploadEpoch=0;
const editor=$('#editor'), editorBody=$('#editor-body');
function message(text,error=false) { $('#message').textContent=text; $('#message').classList.toggle('error',error); }
function locked() { $('#dashboard').hidden=true; $('#books').innerHTML=''; $('#assets').innerHTML=''; $('#logout').hidden=true; $('#login-panel').hidden=false; catalog={books:[],assets:[]}; if(editor.open) editor.close(); }
async function api(url, options={}) {
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const result=await response.json();
  if(!response.ok) {
    if(response.status===401 && url!=='/api/admin/login') locked();
    throw new Error(result.error || 'Không thể hoàn thành thao tác.');
  }
  return result;
}
async function refresh() {
  catalog=await api('/api/admin/catalog');
  $('#login-panel').hidden=true; $('#dashboard').hidden=false; $('#logout').hidden=false;
  paint();
}
function paint() {
  const q=$('#book-search').value.trim().toLocaleLowerCase('vi');
  $('#books').innerHTML=catalog.books.filter(b=>`${b.title} ${b.author}`.toLocaleLowerCase('vi').includes(q)).map(book=>`
    <article class="panel admin-book"><div class="row between"><div><h2>${escape(book.title)}</h2><small>${escape(book.author)} · ${escape(book.genre)} · ${book.hidden?'Đã ẩn':'Đang hiển thị'}${book.demo?' · Truyện mẫu':''}</small></div>
    <div class="admin-actions"><button data-action="book-edit" data-id="${book.id}">Sửa truyện</button><button data-action="book-toggle" data-id="${book.id}">${book.hidden?'Hiện':'Ẩn'}</button><button class="danger" data-action="book-delete" data-id="${book.id}">Xóa</button>${!book.demo?`<button class="primary" data-action="chapter-new" data-id="${book.id}">+ Đăng chương</button>`:''}</div></div>
    ${(book.chapterList || []).slice().sort((a,b)=>a.number-b.number).map(ch=>`<div class="chapter-row"><div class="chapter-label">Chương ${ch.number} · ${escape(ch.title)}<small>${ch.hidden?'Đã ẩn':ch.publishAt && Date.parse(ch.publishAt)>Date.now()?`Hẹn đăng ${new Date(ch.publishAt).toLocaleString('vi-VN')}`:'Đã đăng'}</small></div><button data-action="chapter-edit" data-id="${book.id}" data-number="${ch.number}">Sửa</button><button data-action="chapter-toggle" data-id="${book.id}" data-number="${ch.number}">${ch.hidden?'Hiện':'Ẩn'}</button><button class="danger" data-action="chapter-delete" data-id="${book.id}" data-number="${ch.number}">Xóa</button></div>`).join('')}
    </article>`).join('') || '<div class="empty">Chưa có truyện phù hợp.</div>';
  $('#assets').innerHTML=catalog.assets.map(a=>`<figure><img src="${a.url}" alt="${escape(a.name)}"><figcaption>${escape(a.name)}<br>${{avatar:'Avatar',frame:'Khung avatar',emoji:'Emoji',cover:'Ảnh bìa'}[a.kind]} · ${a.price} xu</figcaption></figure>`).join('') || '<p>Chưa có tài nguyên tải lên.</p>';
}
function modal(title,html) {
  uploadEpoch++;
  $('#editor-title').textContent=title; editorBody.innerHTML=html; $('#editor-error').textContent='';
  if(!editor.open) editor.showModal();
}
const field=(id,label,value='',type='text',extra='')=>`<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" value="${escape(value)}" ${extra}></div>`;
function bookEditor(book) {
  fileData='';
  modal(book?'Chỉnh sửa truyện':'Tạo truyện mới',`<form id="book-form" data-id="${book?.id || ''}">
    ${field('title','Tên truyện',book?.title,'text','required maxlength="160"')}
    <div class="form-grid">${field('author','Tác giả',book?.author,'text','required maxlength="100"')}${field('genre','Thể loại',book?.genre,'text','required maxlength="60"')}</div>
    <div class="form-grid"><div class="form-field"><label for="status">Trạng thái</label><select id="status" name="status"><option ${book?.status==='Đang cập nhật'?'selected':''}>Đang cập nhật</option><option ${book?.status==='Hoàn thành'?'selected':''}>Hoàn thành</option></select></div>${field('rawSource','Nguồn gốc / tên truyện gốc',book?.rawSource,'text','maxlength="200"')}</div>
    <div class="form-field"><label for="description">Tóm tắt</label><textarea id="description" name="description" maxlength="10000">${escape(book?.description)}</textarea></div>
    ${field('tags','Thẻ, phân cách bằng dấu phẩy',book?.tags,'text','maxlength="300"')}
    <div class="form-field"><label for="cover">Ảnh bìa đã tải lên</label><select id="cover" name="cover"><option value="">Bìa chữ</option>${catalog.assets.filter(a=>a.kind==='cover').map(a=>`<option value="${a.url}" ${book?.cover===a.url?'selected':''}>${escape(a.name)}</option>`).join('')}</select></div>
    <div class="form-field"><label for="cover-file">Hoặc tải ảnh bìa mới (tối đa 2 MB)</label><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div>
    <img id="cover-preview" class="cover-preview" ${book?.cover?`src="${book.cover}"`:'hidden'} alt="Xem trước ảnh bìa">
    <label class="check-label"><input name="hidden" type="checkbox" ${book?.hidden?'checked':''}>Ẩn truyện khỏi kệ sách</label>
    <div class="submit-row"><button type="submit" class="primary">Lưu truyện</button><button type="button" data-action="close">Hủy</button></div></form>`);
}
function paragraphHTML(p={text:'',align:'left'}) {
  return `<div class="paragraph-editor"><div class="row"><small>Đoạn nội dung</small><button type="button" data-action="paragraph-remove">Xóa đoạn</button></div><textarea class="paragraph-input" aria-label="Nội dung đoạn" data-align="${p.align}" data-bold="${Boolean(p.bold)}" data-italic="${Boolean(p.italic)}" data-underline="${Boolean(p.underline)}" maxlength="20000" required>${escape(p.text)}</textarea></div>`;
}
function readParagraphs() { return [...document.querySelectorAll('.paragraph-input')].filter(p=>p.value.trim()).map(p=>({text:p.value.trim(),align:p.dataset.align,bold:p.dataset.bold==='true',italic:p.dataset.italic==='true',underline:p.dataset.underline==='true'})); }
function previewChapter() {
  $('#chapter-preview').innerHTML=readParagraphs().map(p=>`<p style="text-align:${p.align};font-weight:${p.bold?'700':'400'};font-style:${p.italic?'italic':'normal'};text-decoration:${p.underline?'underline':'none'}">${escape(p.text)}</p>`).join('');
}
function chapterEditor(book,ch) {
  currentBook=book; activeParagraph=null;
  const max=Math.max(0,...book.chapterList.map(c=>c.number));
  const localTime=ch?.publishAt ? new Date(Date.parse(ch.publishAt)-new Date(ch.publishAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  modal(ch?'Chỉnh sửa chương':'Đăng chương mới',`<form id="chapter-form" data-number="${ch?.number || ''}">
    <p>${escape(book.title)}</p><div class="form-grid">${field('number','Số chương',ch?.number || max+1,'number','min="1" max="100000" required')}${field('chapter-title','Tiêu đề chương',ch?.title,'text','required maxlength="200"')}</div>
    <p class="muted">Chọn một đoạn rồi dùng thanh công cụ để định dạng. Có thể dán văn bản vào từng đoạn.</p>
    <div class="editor-toolbar" role="toolbar" aria-label="Định dạng đoạn">
      <button type="button" data-action="format" data-format="bold"><b>B</b></button><button type="button" data-action="format" data-format="italic"><i>I</i></button><button type="button" data-action="format" data-format="underline"><u>U</u></button>
      ${[['left','Căn trái'],['center','Căn giữa'],['right','Căn phải'],['justify','Căn đều']].map(([v,label])=>`<button type="button" data-action="align" data-value="${v}">${label}</button>`).join('')}
    </div><div id="paragraphs">${(ch?.paragraphs || [{text:'',align:'left'}]).map(paragraphHTML).join('')}</div>
    <button type="button" data-action="paragraph-add">+ Thêm đoạn</button>
    <div class="form-field"><label for="import-text">Nhập từ tệp TXT (UTF-8, tối đa 1 MB)</label><input id="import-text" type="file" accept="text/plain,.txt"></div>
    <h3>Xem trước nội dung</h3><div id="chapter-preview" class="chapter-preview"></div>
    ${field('publishAt','Hẹn giờ đăng (giờ trên thiết bị, để trống để đăng ngay)',localTime,'datetime-local')}
    <label class="check-label"><input type="checkbox" name="hidden" ${ch?.hidden?'checked':''}>Ẩn chương / lưu nháp</label>
    <div class="submit-row"><button type="submit" class="primary">Lưu chương</button><button type="button" data-action="close">Hủy</button></div></form>`);
  document.querySelectorAll('.paragraph-input').forEach(styleParagraph); previewChapter();
}
function styleParagraph(p) {
  p.style.textAlign=p.dataset.align; p.style.fontWeight=p.dataset.bold==='true'?'700':'400';
  p.style.fontStyle=p.dataset.italic==='true'?'italic':'normal'; p.style.textDecoration=p.dataset.underline==='true'?'underline':'none';
}
function assetEditor() {
  fileData='';
  modal('Tải avatar, khung avatar và emoji',`<form id="asset-form">
    <div class="form-field"><label for="kind">Loại tài nguyên</label><select id="kind" name="kind"><option value="avatar">Avatar</option><option value="frame">Khung avatar</option><option value="emoji">Emoji bình luận</option><option value="cover">Ảnh bìa</option></select></div>
    ${field('asset-name','Tên tài nguyên','','text','required maxlength="80"')}${field('price','Giá xu chanh',0,'number','required min="0" max="1000000"')}
    <div class="form-field"><label for="asset-file">Ảnh PNG, JPEG, GIF hoặc WebP (tối đa 2 MB)</label><input id="asset-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></div>
    <p>Kiểm tra ảnh và khung trên vùng avatar hình tròn trước khi lưu.</p>
    <div class="upload-preview"><div class="circle-preview">CN<img id="circle-image" hidden alt="Xem trước trên avatar tròn"></div><img id="raw-image" class="raw-preview" hidden alt="Ảnh gốc"></div>
    <div class="submit-row"><button type="submit" class="primary">Tải lên</button><button type="button" data-action="close">Hủy</button></div></form>`);
}
async function readImage(file) {
  if(!file || file.size>2*1024*1024 || !['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) throw new Error('Chọn ảnh PNG, JPEG, GIF hoặc WebP tối đa 2 MB.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Không đọc được ảnh.'));reader.readAsDataURL(file);});
  await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>image.naturalWidth<=4096 && image.naturalHeight<=4096?resolve():reject(new Error('Kích thước ảnh tối đa 4096 × 4096.'));image.onerror=()=>reject(new Error('Tệp không phải ảnh hợp lệ.'));image.src=data;});
  return data;
}
function updateAssetPreview() {
  if(!fileData) return;
  $('#circle-image').src=fileData; $('#raw-image').src=fileData;
  $('#circle-image').hidden=false; $('#raw-image').hidden=false;
  $('#circle-image').classList.toggle('frame-preview',$('#kind').value==='frame');
}
function confirmDelete(book,number) {
  modal('Xác nhận xóa',`<p>${number?`Xóa chương ${number} của`:'Xóa truyện và toàn bộ chương của'} <strong>${escape(book.title)}</strong>? Thao tác này không thể khôi phục.</p><button class="danger" data-action="delete-confirm" data-id="${book.id}" ${number?`data-number="${number}"`:''}>Xóa vĩnh viễn</button> <button data-action="close">Hủy</button>`);
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]'); if(!button || button.disabled) return;
  const {action,id,value,number}=button.dataset, book=catalog.books.find(b=>b.id===id), chapter=book?.chapterList.find(ch=>ch.number===Number(number));
  try {
    if(action==='close') editor.close();
    if(action==='refresh') {await refresh();message('Đã làm mới nội dung.');}
    if(action==='book-new') bookEditor();
    if(action==='book-edit' && book) bookEditor(book);
    if(action==='asset-new') assetEditor();
    if(action==='chapter-new' && book) chapterEditor(book);
    if(action==='chapter-edit' && chapter) chapterEditor(book,chapter);
    if(action==='book-delete' || action==='chapter-delete') confirmDelete(book,number);
    if(action==='book-toggle') {await api(`/api/admin/books/${id}`,{method:'PUT',body:JSON.stringify({...book,hidden:!book.hidden})});await refresh();message('Đã đổi trạng thái truyện.');}
    if(action==='chapter-toggle') {await api(`/api/admin/books/${id}/chapters/${number}`,{method:'PUT',body:JSON.stringify({...chapter,hidden:!chapter.hidden})});await refresh();message('Đã đổi trạng thái chương.');}
    if(action==='delete-confirm') {button.disabled=true;await api(`/api/admin/books/${id}${number?`/chapters/${number}`:''}`,{method:'DELETE'});editor.close();await refresh();message('Đã xóa nội dung.');}
    if(action==='paragraph-add') {$('#paragraphs').insertAdjacentHTML('beforeend',paragraphHTML());activeParagraph=$('#paragraphs').lastElementChild.querySelector('textarea');activeParagraph.focus();}
    if(action==='paragraph-remove') {if(document.querySelectorAll('.paragraph-input').length>1) {button.closest('.paragraph-editor').remove();activeParagraph=null;previewChapter();}}
    if(action==='align' || action==='format') {
      activeParagraph ||= document.querySelector('.paragraph-input');
      if(!activeParagraph?.isConnected) return;
      if(action==='align') activeParagraph.dataset.align=value;
      else activeParagraph.dataset[button.dataset.format]=String(activeParagraph.dataset[button.dataset.format]!=='true');
      styleParagraph(activeParagraph); activeParagraph.focus(); previewChapter();
    }
  } catch(error) {if(editor.open) $('#editor-error').textContent=error.message;else message(error.message,true);button.disabled=false;}
});
document.addEventListener('focusin',event=>{if(event.target.matches('.paragraph-input')) activeParagraph=event.target;});
document.addEventListener('input',event=>{if(event.target.id==='book-search') paint();if(event.target.matches('.paragraph-input')) previewChapter();});
document.addEventListener('change',async event=>{
  try {
    if(['asset-file','cover-file'].includes(event.target.id)) {
      const epoch=++uploadEpoch;
      fileData='';
      const data=await readImage(event.target.files[0]);
      // Ignore an old FileReader completion after the user has closed the form.
      if(!event.target.isConnected || epoch!==uploadEpoch) return;
      fileData=data;
      if(event.target.id==='asset-file') updateAssetPreview();
      else {$('#cover-preview').src=data;$('#cover-preview').hidden=false;}
    }
    if(event.target.id==='kind') updateAssetPreview();
    if(event.target.id==='cover') {$('#cover-preview').src=event.target.value;$('#cover-preview').hidden=!event.target.value;}
    if(event.target.id==='import-text') {
      const file=event.target.files[0];if(!file || file.size>1024*1024) throw new Error('Tệp TXT tối đa 1 MB.');
      const text=await file.text(), paragraphs=text.trim().split(/\n\s*\n/).filter(Boolean);
      if(paragraphs.length>2000 || text.length>300000 || paragraphs.some(p=>p.length>20000)) throw new Error('Nội dung TXT quá dài.');
      $('#paragraphs').innerHTML=paragraphs.map(text=>paragraphHTML({text,align:'left'})).join('') || paragraphHTML();activeParagraph=null;previewChapter();
    }
    $('#editor-error').textContent='';
  } catch(error) {event.target.value='';fileData='';$('#editor-error').textContent=error.message;}
});
document.addEventListener('submit',async event=>{
  event.preventDefault(); const form=event.target,data=new FormData(form), submit=form.querySelector('[type="submit"]');
  if(submit.disabled) return;
  submit.disabled=true;
  try {
    if(form.id==='login-form') {await api('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(data))});form.reset();await refresh();message('Đã đăng nhập.');return;}
    if(form.id==='book-form') {
      let cover=data.get('cover');
      if(fileData) {const asset=await api('/api/admin/assets',{method:'POST',body:JSON.stringify({kind:'cover',name:String(data.get('title')).slice(0,80),price:0,data:fileData})});cover=asset.url;fileData='';$('#cover-file').value='';$('#cover').insertAdjacentHTML('beforeend',`<option selected value="${asset.url}">${escape(asset.name)}</option>`);}
      await api('/api/admin/books'+(form.dataset.id?'/'+form.dataset.id:''),{method:form.dataset.id?'PUT':'POST',body:JSON.stringify({...Object.fromEntries(data),cover,hidden:data.has('hidden')})});
    }
    if(form.id==='chapter-form') {
      const paragraphs=readParagraphs();if(!paragraphs.length) throw new Error('Hãy nhập nội dung chương.');
      await api(`/api/admin/books/${currentBook.id}/chapters`+(form.dataset.number?'/'+form.dataset.number:''),{method:form.dataset.number?'PUT':'POST',body:JSON.stringify({number:Number(data.get('number')),title:data.get('chapter-title'),paragraphs,hidden:data.has('hidden'),publishAt:data.get('publishAt')?new Date(data.get('publishAt')).toISOString():null})});
    }
    if(form.id==='asset-form') {
      if(!fileData) throw new Error('Chọn ảnh và chờ xem trước trước khi tải lên.');
      await api('/api/admin/assets',{method:'POST',body:JSON.stringify({kind:data.get('kind'),name:data.get('asset-name'),price:Number(data.get('price')),data:fileData})});
    }
    editor.close();await refresh();message('Đã lưu thành công.');
  } catch(error) {if(editor.open) $('#editor-error').textContent=error.message;else message(error.message,true);}
  finally {submit.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{try {await api('/api/admin/logout',{method:'POST'});locked();message('Đã đăng xuất.');}catch(error){message(error.message,true);}});
try {await refresh();}catch(error){locked();if(!error.message.includes('đăng nhập')) message(error.message,true);}
