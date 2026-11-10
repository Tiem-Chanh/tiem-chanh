import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDS, canWater, harvestReward, sortBooks, normalizeState, publishedChapters } from '../core.mjs';

test('higher tier plants require more water and return more coins',()=>{
  assert.ok(SEEDS.herb.waterNeeded<SEEDS.lemon.waterNeeded && SEEDS.lemon.waterNeeded<SEEDS.golden.waterNeeded);
  for(const type of Object.keys(SEEDS)) {
    assert.equal(harvestReward(type,()=>0),SEEDS[type].rewardMin);
    assert.equal(harvestReward(type,()=>0.999999),SEEDS[type].rewardMax);
  }
});
test('watering respects cooldown and stops once mature',()=>{
  const plant={type:'herb',water:1,lastWateredAt:100000};
  assert.equal(canWater(plant,159999),false); assert.equal(canWater(plant,160000),true);
  assert.equal(canWater({...plant,water:3},200000),false);
  assert.equal(canWater(null),false);
});
test('rankings compare numeric totals without modifying catalog order',()=>{
  const books=[{title:'B',reads:900,favoriteCount:30},{title:'A',reads:12000,favoriteCount:2}];
  assert.equal(sortBooks(books,'reads')[0].title,'A');assert.equal(sortBooks(books,'favoriteCount')[0].title,'B');assert.equal(books[0].title,'B');
});
test('hidden and future chapters stay out of public navigation, including gaps',()=>{
  const book={chapterList:[{number:7,hidden:false},{number:1,hidden:false},{number:2,hidden:true},{number:3,publishAt:'2099-01-01T00:00:00Z'}]};
  assert.deepEqual(publishedChapters(book,Date.parse('2026-11-10')).map(ch=>ch.number),[1,7]);
});
const defaults={name:'Chanh',theme:'light',fontSize:20,coins:128,lifetimeCoins:240,onlineSeconds:0,coinSeconds:0,plantsGrown:0,favorites:[],ownedAvatars:['sage'],ownedFrames:['none'],avatar:'sage',frame:'none',seeds:{herb:1,lemon:2},garden:[null],queuedPlants:[],library:{},reviews:[],comments:{},bookmarks:{},transactions:[]};
test('corrupted saved state cannot crash nested renderers or create negative balances',()=>{
  const result=normalizeState({name:{},coins:-4,reviews:'oops',library:null,comments:[],fontSize:'999px',garden:[{type:'nope'}],ownedAvatars:null},defaults);
  assert.equal(result.name,'Chanh');assert.equal(result.coins,128);assert.deepEqual(result.reviews,[]);assert.deepEqual(result.garden,[null]);assert.equal(result.fontSize,20);
});
test('six legacy plots migrate to one active plot and a queue without dropping plants',()=>{
  const saved={garden:[{type:'herb'},{type:'lemon'},null,{type:'herb'},null,null],library:{sample:{chapter:7,scrollRatio:0.48}}};
  const result=normalizeState(saved,defaults);
  assert.equal(result.garden.length,1);assert.equal(result.queuedPlants.length,2);assert.equal(result.library.sample.scrollRatio,0.48);
  assert.deepEqual(saved.garden[0],{type:'herb'});
});
