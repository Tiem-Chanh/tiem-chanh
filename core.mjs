export const SEEDS = Object.freeze({
  herb: { name: 'Mầm bình yên', price: 8, waterNeeded: 3, rewardMin: 10, rewardMax: 14 },
  lemon: { name: 'Chanh vàng', price: 12, waterNeeded: 6, rewardMin: 18, rewardMax: 28 },
  golden: { name: 'Chanh hoàng kim', price: 24, waterNeeded: 10, rewardMin: 35, rewardMax: 55 }
});
export const WATER_COOLDOWN = 60_000;
export function canWater(plant, now = Date.now()) {
  return Boolean(plant && SEEDS[plant.type] && plant.water < SEEDS[plant.type].waterNeeded &&
    now - (plant.lastWateredAt || 0) >= WATER_COOLDOWN);
}
export function harvestReward(type, random = Math.random) {
  const seed = SEEDS[type];
  if (!seed) throw new Error('Giống cây không hợp lệ');
  return seed.rewardMin + Math.min(seed.rewardMax - seed.rewardMin,
    Math.max(0, Math.floor(random() * (seed.rewardMax - seed.rewardMin + 1))));
}
export function sortBooks(books, field) {
  return [...books].sort((a,b) => (Number(b[field]) || 0) - (Number(a[field]) || 0) ||
    a.title.localeCompare(b.title, 'vi'));
}
export function publishedChapters(book, now = Date.now()) {
  return (book.chapterList || []).filter(ch => !ch.hidden && (!ch.publishAt || Date.parse(ch.publishAt) <= now))
    .sort((a,b) => a.number - b.number);
}
export function normalizeState(saved, defaults) {
  const state = structuredClone(defaults);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return state;
  const count = (value, fallback = 0, max = 1e9) => Number.isFinite(value) && value >= 0 ? Math.min(max,Math.floor(value)) : fallback;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const ids = value => Array.isArray(value) ? [...new Set(value.filter(id=>typeof id==='string' && /^[a-zA-Z0-9-]{1,100}$/.test(id)))] : [];
  state.name = typeof saved.name==='string' && saved.name.trim() ? saved.name.trim().slice(0,30) : state.name;
  if (['light','dark','system'].includes(saved.theme)) state.theme=saved.theme;
  if ([18,20,24,28].includes(saved.fontSize)) state.fontSize=saved.fontSize;
  for (const key of ['coins','lifetimeCoins','onlineSeconds','plantsGrown']) state[key]=count(saved[key],state[key]);
  state.coinSeconds=count(saved.coinSeconds)%600;
  for (const key of ['favorites','ownedAvatars','ownedFrames']) if(Array.isArray(saved[key])) state[key]=ids(saved[key]);
  state.ownedAvatars=[...new Set(['sage',...state.ownedAvatars])];
  state.ownedFrames=[...new Set(['none',...state.ownedFrames])];
  if(state.ownedAvatars.includes(saved.avatar)) state.avatar=saved.avatar;
  if(state.ownedFrames.includes(saved.frame)) state.frame=saved.frame;
  if(record(saved.seeds)) for(const id of Object.keys(SEEDS)) state.seeds[id]=count(saved.seeds[id],state.seeds[id] || 0,100000);
  const plant = value => record(value) && SEEDS[value.type] ? {type:value.type,water:count(value.water,0,SEEDS[value.type].waterNeeded),lastWateredAt:count(value.lastWateredAt),plantedAt:count(value.plantedAt)} : null;
  const oldGarden=Array.isArray(saved.garden)?saved.garden:[];
  state.garden=[plant(oldGarden[0])];
  state.queuedPlants=[...oldGarden.slice(1),...(Array.isArray(saved.queuedPlants)?saved.queuedPlants:[])].map(plant).filter(Boolean).slice(0,100);
  if(!state.garden[0] && state.queuedPlants.length) state.garden[0]=state.queuedPlants.shift();
  if(record(saved.library)) for(const [id,entry] of Object.entries(saved.library)) {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(id) || !record(entry)) continue;
    state.library[id]={chapter:Math.max(1,count(entry.chapter,1,100000)),completed:entry.completed===true,updatedAt:count(entry.updatedAt),scrollRatio:Math.min(1,Number.isFinite(entry.scrollRatio)?Math.max(0,entry.scrollRatio):0)};
  }
  state.reviews=Array.isArray(saved.reviews)?saved.reviews.filter(r=>record(r) && ids([r.id]).length && ids([r.bookId]).length).map(r=>({id:r.id,bookId:r.bookId,status:r.status==='written'?'written':'planned',rating:Math.max(1,count(r.rating,5,5)),text:String(r.text || '').slice(0,5000),updatedAt:count(r.updatedAt)})):[];
  state.comments={};
  if(record(saved.comments)) for(const [key,list] of Object.entries(saved.comments)) if(/^[a-zA-Z0-9:-]{1,220}$/.test(key) && Array.isArray(list)) state.comments[key]=list.filter(c=>record(c) && ids([c.id]).length).map(c=>({id:c.id,name:String(c.name || 'Độc giả').slice(0,30),text:String(c.text || '').slice(0,1200),at:count(c.at),parentId:ids([c.parentId])[0] || null,liked:c.liked===true,emojiId:ids([c.emojiId])[0] || null}));
  state.bookmarks={};
  if(record(saved.bookmarks)) for(const [key,value] of Object.entries(saved.bookmarks)) if(/^[a-zA-Z0-9:-]{1,220}$/.test(key)) state.bookmarks[key]=value===true;
  state.transactions=[];
  return state;
}
