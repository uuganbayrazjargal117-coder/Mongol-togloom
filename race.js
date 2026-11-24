import { mountGameSwitch } from './game-switch-ui.mjs';
import * as THREE from 'three';
import {playShagaiSound, THROW_DURATION} from './shagai-audio.js';
import {setupHandThrow} from './hand-throw.js';
import {
 advance,hasHorseMovement,HORSE_AGE_CATEGORIES,horseTrackOptions,isValidHorseRaceSelection,
 finishTitle,foalLastPlaceAnnouncement,buildHorseTrackPath,
 HORSE_TRACK_MARKER_SCALE,horseTrackCameraFrame
} from './race-logic.mjs';
import {createHorseMultiplayer} from './race-multiplayer.mjs';
const $=id=>document.getElementById(id);
const palette=['#ef3836','#f3d029','#3d8dde','#eb97b2','#318439','#191e58','#e45433','#58c5c8','#25a8df','#68261d','#f2b653','#a2a9dc'];
const names=['Морь','Тэмээ','Хонь','Ямаа'];
// The two narrow sides are horse/camel; broad sides are sheep/goat.
const sideAngles=[Math.PI/2,-Math.PI/2,0,Math.PI];
let boneSurface,geometry,board,tray,racers=[],bones=[],track=new THREE.Group(),trackPath=[],horseCategory=null,current=0,length=18,ranking=[],busy=false,active=false,throwMotion=null,moveMotion=null,turnMotion=null,localAnimation=null,localRun=0,localEndReason=null,cameraFocus={x:0,z:0},followCamera=true;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const multiplayerMode=new URLSearchParams(location.search).get('lan')==='1';
let multiplayer=null,raceReady=false,networkBoardGame=null;

function showNetworkFaces(faces){
 $('face-labels').replaceChildren(...faces.map(f=>{
  const label=document.createElement('span');label.textContent=names[f];
  if(f===0)label.style.color='#8a1726';return label;
 }));
}
function renderGameOver({players,ranking,trackLength,endReason,horseCategory}){
 const places=new Map(ranking.map((id,index)=>[String(id),index]));
 const standings=[...players].sort((a,b)=>{
  const placeA=places.get(String(a.id)),placeB=places.get(String(b.id));
  if(placeA!==undefined||placeB!==undefined)return (placeA??Infinity)-(placeB??Infinity);
  return b.position-a.position||a.seat-b.seat;
 });
 $('game-over-title').textContent=endReason==='finish'?'Уралдаан дууслаа':endReason==='ended-early'?'Уралдаан эрт дууслаа':'Тоглоом дууслаа';
 const winner=endReason==='finish'?standings.find(player=>places.has(String(player.id))):null;
 $('game-over-message').textContent=endReason==='finish'
  ?`${finishTitle(1)}: ${winner?.name??'—'}`
  :endReason==='ended-early'?'Барианд хүрсэн морь байхгүй. Одоогийн байрлалыг харуулав.':'Тоглоомыг дуусгаж, одоогийн байрлалыг хадгаллаа.';
 $('game-over-standings').replaceChildren(...standings.map(player=>{
  const row=document.createElement('div');row.className='game-over-standing';
  const name=document.createElement('span');name.textContent=player.name;
  const place=places.get(String(player.id));
  const position=document.createElement('strong');position.textContent=place!==undefined?`${finishTitle(place+1)} · Барианд`:`${player.position} / ${trackLength}`;
  row.append(name,position);return row;
 }));
 const lastPlaceMessage=foalLastPlaceAnnouncement(horseCategory,ranking,players.length,endReason==='finish');
 $('game-over-special').hidden=!lastPlaceMessage;
 $('game-over-special').textContent=lastPlaceMessage||'';
 const lastFinisher=lastPlaceMessage?players.find(player=>String(player.id)===String(ranking.at(-1))):null;
 $('game-over-special-player').hidden=!lastFinisher;
 $('game-over-special-player').textContent=lastFinisher?`Баян ходоод: ${lastFinisher.name}`:'';
 $('play-again').disabled=multiplayerMode&&!multiplayer?.canRestart();
 $('game-over').hidden=false;
}
function showLocalGameOver(){
 renderGameOver({
  players:racers.map((r,i)=>({id:String(i),name:`Тоглогч ${i+1}`,position:r.position,seat:i})),
  ranking:ranking.map(String),trackLength:length,endReason:localEndReason,horseCategory
 });
}
function endLocalGame(){
 if(!active)return;
 active=false;localEndReason=ranking.length===0?'ended-early':'ended-by-player';localRun++;
 localAnimation?.abort();localAnimation=null;cancelRaceAnimations();
 $('throw').disabled=true;$('end-game').hidden=true;$('new-game').disabled=false;
 update();showLocalGameOver();
}
function renderNetworkControls({state,playerId,canThrow,canRestart=false,canEnd=false,canSwitch=false}){
 $('throw').disabled=!canThrow;
 $('end-game').hidden=!state||state.hostId!==playerId||state.finished;
 $('end-game').disabled=!canEnd;
 if(state){$('switch-game').hidden=state.hostId!==playerId;$('switch-game').disabled=!canSwitch;}
 $('new-game').disabled=!canRestart;
 if(state)$('new-game').hidden=state.hostId!==playerId;
 if(!raceReady||!state)return;
 $('winner-announcement').hidden=!state.ranking.length;
 $('winner-announcement').textContent=state.ranking.length
  ?`${finishTitle(1)}: ${state.players.find(p=>p.id===state.ranking[0])?.name??'—'}`:'';
 const currentPlayer=state.players.find(p=>p.id===state.currentPlayerId);
 $('turn').textContent=state.finished?'Race finished':currentPlayer?`${currentPlayer.name} · Seat ${currentPlayer.seat+1}`:'Waiting for players to reconnect';
 $('race-scores').replaceChildren(...state.players.map(p=>{
  const row=document.createElement('div');row.className='race-score'+(p.id===state.currentPlayerId&&!state.finished?' active':'');
  const label=document.createElement('span');label.className='player-name';
  const dot=document.createElement('i');dot.className='swatch';dot.style.background=palette[state.players.indexOf(p)];
  label.append(dot,document.createTextNode(`${p.name} · Seat ${p.seat+1}${p.id===playerId?' (You)':''}${p.connected?'':' · offline'}`));
  const score=document.createElement('strong');const rank=state.ranking.indexOf(p.id);
  score.textContent=rank>=0?finishTitle(rank+1):`${p.position} / ${state.trackLength}`;
  row.append(label,score);return row;
 }));
 racers.forEach((r,i)=>{r.outline.visible=!state.finished&&state.players[i]?.id===state.currentPlayerId;});
}
async function applyHorseState(state,{animate,signal}){
 if(signal?.aborted)return;
 const reset=networkBoardGame!==state.id;
 length=state.trackLength;
 horseCategory=state.horseCategory;
 $('horse-category').value=horseCategory;
 populateRaceDistances(horseCategory,length);
 if(networkBoardGame===null||racers.length!==state.players.length||Number($('track-length').value)!==length||trackPath.length!==length+1){
  makeBoard(state.players.length,state.players.map(p=>p.seat+1));
 }
 networkBoardGame=state.id;
 if(reset){busy=false;bones.forEach((m,i)=>{m.position.set((1.5-i)*1.28,.5,0);m.rotation.set(0,0,sideAngles[i]);});showNetworkFaces([0,1,2,3]);}
 $('race-setup').hidden=true;$('track-length').disabled=true;$('horse-category').disabled=true;$('race-players').disabled=true;$('begin').disabled=true;
 $('track-label').textContent=trackDescription(horseCategory,length);
 active=!state.finished;current=state.players.findIndex(p=>p.id===state.currentPlayerId);
 ranking=state.ranking.map(id=>state.players.findIndex(p=>p.id===id));
 const last=state.lastThrow;
 state.players.forEach((p,i)=>{
  racers[i].position=p.position;racers[i].finished=p.finished;
  racers[i].hasThrown=p.hasThrown;racers[i].facingForward=p.facingForward;
  const startPosition=animate&&last?.playerId===p.id?last.fromPosition:p.position;
  const startPoint=trackPoint(startPosition,racers[i].lane);
  racers[i].mesh.position.x=startPoint.x;racers[i].mesh.position.z=startPoint.z;
  racers[i].mesh.rotation.y=facingRotation(startPosition,animate&&last?.playerId===p.id&&last.turnedForward?false:p.facingForward);
 });
 if(animate&&last){
  busy=true;$('result').textContent='Дөрвөн шагай хаяж байна…';
  $('face-labels').replaceChildren(...names.map(()=>{const el=document.createElement('span');el.textContent='…';return el;}));
  // Audio decoding never delays the network animation or holds up the server turn.
  void playShagaiSound();
  await animateThrow(last.faces);if(signal?.aborted)return;showNetworkFaces(last.faces);
  const actor=state.players.findIndex(p=>p.id===last.playerId);
  await animateHorse(racers[actor],last,signal);if(signal?.aborted)return;busy=false;
 }else if(state.faces.length){
  showNetworkFaces(state.faces);
  bones.forEach((m,i)=>{m.rotation.set(0,0,sideAngles[state.faces[i]]);});
 }
 state.players.forEach((p,i)=>{const position=trackPoint(p.position,racers[i].lane);racers[i].mesh.position.x=position.x;racers[i].mesh.position.z=position.z;racers[i].mesh.position.y=.43;});
 update();
 const actor=last&&state.players.find(p=>p.id===last.playerId);
 $('result').textContent=state.finished
  ? 'Final ranking: '+state.ranking.map((id,i)=>`${finishTitle(i+1)} — ${state.players.find(p=>p.id===id).name}`).join(' · ')
  : last?`${actor.name}: ${last.different?'Дөрвөн бэрх!':last.horses+' морь'} · +${last.steps} · ${last.position} / ${length}`
  : 'Waiting for the current player to throw.';
 if(state.finished)renderGameOver({players:state.players,ranking:state.ranking,trackLength:state.trackLength,endReason:state.endReason,horseCategory:state.horseCategory});
 else $('game-over').hidden=true;
}
function surface(id){
 const host=$(id),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-10,10,6,-6,.1,100);
 camera.up.set(0,0,-1);camera.position.set(0,30,0);camera.lookAt(0,0,0);
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.append(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xfff5e7,0x6d6254,.75));
 const key=new THREE.DirectionalLight(0xfff1da,3.6);key.position.set(-9,15,-6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-16,right:16,top:16,bottom:-16,near:1,far:60});key.shadow.bias=-.0005;key.shadow.normalBias=.025;scene.add(key);
 const fill=new THREE.DirectionalLight(0xdceaff,.35);fill.position.set(8,10,5);scene.add(fill);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,80),new THREE.ShadowMaterial({opacity:.23}));ground.rotation.x=-Math.PI/2;ground.position.y=.03;ground.receiveShadow=true;scene.add(ground);
 return {host,scene,camera,renderer};
}
function fit(view,width,height,centerX=0,centerZ=0){const ratio=view.host.clientWidth/view.host.clientHeight;const w=Math.max(width,height*ratio),h=w/ratio;Object.assign(view.camera,{left:-w/2,right:w/2,top:h/2,bottom:-h/2});view.camera.position.set(centerX,30,centerZ);view.camera.lookAt(centerX,0,centerZ);view.camera.updateProjectionMatrix();view.renderer.setSize(view.host.clientWidth,view.host.clientHeight);}
function frameBoard(){
 const {width,height}=horseTrackCameraFrame(board.host.clientWidth/board.host.clientHeight);
 Object.assign(board.camera,{left:-width/2,right:width/2,top:height/2,bottom:-height/2});
 board.camera.position.set(cameraFocus.x,30,cameraFocus.z);board.camera.lookAt(cameraFocus.x,0,cameraFocus.z);
 board.camera.updateProjectionMatrix();board.renderer.setSize(board.host.clientWidth,board.host.clientHeight);
}
function resize(){
 if(!board)return;
 frameBoard();fit(tray,5.5,2.2);
}
function setFollowCamera(enabled){
 followCamera=enabled;
 const button=$('follow-camera');
 button.setAttribute('aria-pressed',String(enabled));
 button.textContent=enabled?'Морийг дагах камер: асаалттай':'Морийг дагах камер: унтраалттай';
 if(enabled&&racers[current]?.mesh){cameraFocus.x=racers[current].mesh.position.x;cameraFocus.z=racers[current].mesh.position.z;}
}
function followCurrentHorse(){
 if(followCamera&&racers[current]?.mesh){
  const position=racers[current].mesh.position;
  cameraFocus.x+=(position.x-cameraFocus.x)*.08;cameraFocus.z+=(position.z-cameraFocus.z)*.08;
 }
 board.camera.position.set(cameraFocus.x,30,cameraFocus.z);board.camera.lookAt(cameraFocus.x,0,cameraFocus.z);
}
function bone(color,scale=1){const mesh=new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({color,vertexColors:true,map:boneSurface.color,bumpMap:boneSurface.bump,bumpScale:.007,roughness:.5,metalness:0,clearcoat:.13,clearcoatRoughness:.42}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.scale.setScalar(scale);return mesh;}
function textSprite(text,color='#503528'){const c=document.createElement('canvas');c.width=256;c.height=96;const cx=c.getContext('2d');cx.font='bold 44px sans-serif';cx.textAlign='center';cx.fillStyle=color;cx.fillText(text,128,62);const texture=new THREE.CanvasTexture(c),m=new THREE.SpriteMaterial({map:texture,transparent:true,toneMapped:false});const s=new THREE.Sprite(m);s.scale.set(1.45,.55,1);return s;}
function clearTrack(){track.traverse(o=>{if(o.geometry&&o.geometry!==geometry)o.geometry.dispose();if(o.material){if(o.material.map && o.material.map!==boneSurface.color)o.material.map.dispose();o.material.dispose();}});track.clear();}
function trackPoint(position,lane=0){
 const bounded=Math.max(0,Math.min(length,position)),index=Math.min(length-1,Math.floor(bounded)),fraction=bounded-index;
 const a=trackPath[index],b=trackPath[index+1],dx=b.x-a.x,dz=b.z-a.z;
 const size=Math.hypot(dx,dz)||1,nx=-dz/size,nz=dx/size;
 return new THREE.Vector3(a.x+dx*fraction+nx*lane,0,a.z+dz*fraction+nz*lane);
}
function trackHeading(position){
 const bounded=Math.max(0,Math.min(length,position)),index=Math.min(length-1,Math.floor(bounded));
 const a=trackPath[index],b=trackPath[index+1];
 return Math.atan2(b.z-a.z,b.x-a.x);
}
function facingRotation(position,forward){return Math.PI/2-trackHeading(position)+(forward?0:Math.PI);}
function populateRaceDistances(categoryId,selectedLength){
 const select=$('track-length');
 select.replaceChildren(new Option('Замын зайг сонгоно уу',''));
 for(const option of horseTrackOptions(categoryId))select.add(new Option(`${option.kilometers} км · ${option.trackLength} шагай`,String(option.trackLength)));
 select.value=selectedLength==null?'':String(selectedLength);
}
function trackDescription(categoryId,trackLength){
 const category=HORSE_AGE_CATEGORIES.find(item=>item.id===categoryId);
 return `${category?.name??'Морь'} · ${trackLength/2} км · ${trackLength} шагай`;
}
function makeBoard(n,seats){
 clearTrack();trackPath=buildHorseTrackPath(length);
 racers=Array.from({length:n},(_,i)=>({position:0,finished:false,hasThrown:false,facingForward:false,color:palette[i],lane:(i%2===0?-1:1)*(.60+Math.floor(i/2)*.62)}));
 const laneExtent=Math.max(.65,...racers.map(r=>Math.abs(r.lane)));
 for(let j=1;j<=length;j++){
  const marker=trackPoint(j),m=bone('#286c78',HORSE_TRACK_MARKER_SCALE);m.rotation.set(0,facingRotation(j,true),sideAngles[0]);m.position.set(marker.x,.35,marker.z);track.add(m);
  if(j%3===0||j===length){const labelPoint=trackPoint(j,laneExtent+.75),s=textSprite(String(j));s.position.set(labelPoint.x,.05,labelPoint.z);track.add(s);}
 }
 racers.forEach((r,i)=>{
  const points=Array.from({length:length+1},(_,position)=>{const point=trackPoint(position,r.lane);return new THREE.Vector3(point.x,0,point.z);});
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#79543b',transparent:true,opacity:.13}));track.add(line);const group=new THREE.Group();const m=bone(r.color,1.15);m.rotation.z=sideAngles[0];group.add(m);
 const outline=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide,toneMapped:false}));outline.scale.setScalar(1.075);outline.renderOrder=1;outline.visible=false;m.add(outline);r.outline=outline;
 const halo=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide,transparent:true,opacity:.14,depthWrite:false,toneMapped:false}));halo.scale.setScalar(1.035);outline.add(halo);
 const start=trackPoint(0,r.lane),heading=trackHeading(0);group.position.set(start.x,.43,start.z);group.rotation.y=facingRotation(0,false);track.add(group);r.mesh=group;
  const label=textSprite(String(seats?.[i]??i+1),r.color);label.position.set(start.x-Math.cos(heading)*1.05,.05,start.z-Math.sin(heading)*1.05);track.add(label);
 });
 const finishStart=trackPoint(length,-laneExtent-.45),finishEnd=trackPoint(length,laneExtent+.45);
 const finish=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(finishStart.x,.01,finishStart.z),new THREE.Vector3(finishEnd.x,.01,finishEnd.z)]),new THREE.LineBasicMaterial({color:0x79543b}));track.add(finish);
 const followed=racers[current]??racers[0];cameraFocus.x=followed.mesh.position.x;cameraFocus.z=followed.mesh.position.z;resize();
}
function update(){
 $('turn').textContent=active?`Тоглогч ${current+1}`:'Тоглоом дууслаа';
 $('winner-announcement').hidden=ranking.length===0;
 $('winner-announcement').textContent=ranking.length?`${finishTitle(1)}: Тоглогч ${ranking[0]+1}`:'';
 $('race-scores').replaceChildren(...racers.map((r,i)=>{const row=document.createElement('div');row.className='race-score'+(active&&i===current?' active':'');const name=document.createElement('span');name.className='player-name';const dot=document.createElement('i');dot.className='swatch';dot.style.background=r.color;name.append(dot,document.createTextNode(`Тоглогч ${i+1}`));const score=document.createElement('strong');score.textContent=r.finished?finishTitle(ranking.indexOf(i)+1):`${r.position} / ${length}`;row.append(name,score);return row;}));
 racers.forEach((r,i)=>{r.mesh.children[0].material.emissive.setHex(0);r.outline.visible=i===current&&active;});
}
function start(){
 if(multiplayerMode||busy)return;
 const category=$('horse-category').value,selectedLength=Number($('track-length').value);
 if(!isValidHorseRaceSelection(category,selectedLength)){$('begin').disabled=true;return;}
 let n=Math.max(1,Math.min(12,Math.floor(Number($('race-players').value)||2)));$('race-players').value=n;
 horseCategory=category;length=selectedLength;ranking=[];current=0;active=true;localRun++;localEndReason=null;
 $('game-over').hidden=true;$('end-game').hidden=false;$('end-game').disabled=false;makeBoard(n);
 bones.forEach((m,i)=>{m.position.set((1.5-i)*1.28,.5,0);m.rotation.set(0,0,sideAngles[i]);});
 $('face-labels').replaceChildren(...names.map(name=>{const label=document.createElement('span');label.textContent=name;return label;}));
 $('track-label').textContent=trackDescription(horseCategory,length);$('race-setup').hidden=true;$('throw').disabled=false;$('result').textContent='Дөрвөн шагай хаяж уралдаарай.';update();
}
function next(){if(busy||!active)return;do{current=(current+1)%racers.length;}while(racers[current].finished);$('throw').disabled=false;update();$('throw').focus();}
function animateThrow(faces){return new Promise(resolve=>{throwMotion={start:performance.now(),duration:THROW_DURATION,faces,resolve};});}
function animateTurn(horse,position){return new Promise(resolve=>{turnMotion={start:performance.now(),duration:reduced?150:700,horse,from:facingRotation(position,false),to:facingRotation(position,true),resolve};});}
async function animateHorse(horse,target,signal){
 const fromPosition=target.fromPosition??horse.position;
 if(target.turnedForward)await animateTurn(horse,fromPosition);
 if(signal?.aborted||!hasHorseMovement(fromPosition,target.position))return;
 return new Promise(resolve=>{moveMotion={start:performance.now(),duration:reduced?150:800,horse,from:trackPoint(fromPosition,horse.lane),to:trackPoint(target.position,horse.lane),fromPosition,toPosition:target.position,resolve};});
}
function cancelRaceAnimations(){const oldThrow=throwMotion,oldMove=moveMotion,oldTurn=turnMotion;throwMotion=null;moveMotion=null;turnMotion=null;oldThrow?.resolve();oldMove?.resolve();oldTurn?.resolve();busy=false;}
async function roll(){
 if(multiplayerMode){multiplayer?.requestThrow();return;}
 if(!active||busy)return;
 const generation=localRun,animation=new AbortController();localAnimation=animation;
 busy=true;$('throw').disabled=true;$('new-game').disabled=true;$('result').textContent='Дөрвөн шагай хаяж байна…';
 $('face-labels').replaceChildren(...names.map(()=>{const label=document.createElement('span');label.textContent='…';return label;}));
 try{
  const faces=Array.from({length:4},()=>Math.floor(Math.random()*4));
  await playShagaiSound();
  if(animation.signal.aborted||generation!==localRun)return;
  await animateThrow(faces);
  if(animation.signal.aborted||generation!==localRun)return;
  $('face-labels').replaceChildren(...faces.map(f=>{const label=document.createElement('span');label.textContent=names[f];if(f===0)label.style.color='#8a1726';return label;}));
  const racer=racers[current],result=advance(racer,faces,length);
  await animateHorse(racer,result,animation.signal);
  if(animation.signal.aborted||generation!==localRun)return;
  racer.position=result.position;racer.hasThrown=true;racer.facingForward=result.facingForward;
  let message=`Тоглогч ${current+1}: `+(result.different?'Дөрвөн бэрх! 4 алхам.':result.firstThrow?`${result.horses} морь · эхний хаялт.`:`${result.horses} морь буулаа.`);
  if(result.steps===0)message+=' Байрандаа үлдэнэ.';else message+=` ${racer.position} / ${length} шагай.`;
  if(racer.position===length){racer.finished=true;ranking.push(current);message=`Тоглогч ${current+1} ${finishTitle(ranking.length)}-д барианд орлоо!`;}
  if(ranking.length===racers.length){active=false;localEndReason='finish';$('end-game').hidden=true;message+=` Тоглоом дууслаа. ${finishTitle(1)}: Тоглогч ${ranking[0]+1}.`;}
  $('result').textContent=message;update();
  if(localEndReason==='finish')showLocalGameOver();else if(active){busy=false;next();}
 }finally{
  if(localAnimation===animation)localAnimation=null;
  if(generation===localRun){busy=false;$('new-game').disabled=false;$('throw').disabled=!active;}
 }
}
$('begin').onclick=start;$('throw').onclick=roll;$('new-game').onclick=()=>{if(multiplayerMode){multiplayer?.requestRestart();return;}if(!busy)$('race-setup').hidden=false;};
$('follow-camera').onclick=()=>setFollowCamera(!followCamera);
$('end-game').onclick=()=>{if(multiplayerMode?multiplayer?.canEnd():active)$('end-game-confirmation').showModal();};
$('cancel-end-game').onclick=()=>$('end-game-confirmation').close();
$('confirm-end-game').onclick=()=>{$('end-game-confirmation').close();if(multiplayerMode)multiplayer?.requestEnd();else endLocalGame();};
$('play-again').onclick=()=>{if(multiplayerMode){multiplayer?.requestRestart();return;}$('game-over').hidden=true;$('race-setup').hidden=false;};
$('horse-category').addEventListener('change',()=>{
 const category=$('horse-category').value;
 populateRaceDistances(category,null);$('track-length').disabled=!category;
 $('begin').disabled=true;
});
$('track-length').addEventListener('change',()=>{
 $('begin').disabled=!raceReady||!isValidHorseRaceSelection($('horse-category').value,Number($('track-length').value));
});
$('rules').onclick=()=>$('race-help').showModal();$('close-help').onclick=()=>$('race-help').close();
function makeBoneSurface(){
  const size=128,color=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4);
  let seed=108;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,grain=random(),shade=245+Math.round(5*Math.sin(x*.14)*Math.sin(y*.11)+grain*5);
    color.set([shade,shade-2,shade-6,255],i);
    const pore=grain<.025?65:118+Math.round(grain*35);bump.set([pore,pore,pore,255],i);
  }
  const texture=bytes=>{const t=new THREE.DataTexture(bytes,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
  const surface=texture(color);surface.colorSpace=THREE.SRGBColorSpace;
  return {color:surface,bump:texture(bump)};
}

async function init(){try{const response=await fetch('./race-bone.json');if(!response.ok)throw Error('Шагайн загвар олдсонгүй');const data=await response.json();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geometry.setIndex(data.faces);geometry.computeVertexNormals();geometry.setAttribute('color',new THREE.Float32BufferAttribute(data.colors,3));const uv=[];for(let i=0;i<data.vertices.length;i+=3)uv.push((data.vertices[i]+.281)/.561,(data.vertices[i+2]+.44)/.88);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));boneSurface=makeBoneSurface();board=surface('race-scene');tray=surface('throw-scene');tray.camera.up.set(0,0,1);tray.camera.lookAt(0,0,0);board.scene.add(track);for(let i=0;i<4;i++){const m=bone('#f4e4c7',1.45);m.position.set((1.5-i)*1.28,.5,0);m.rotation.z=sideAngles[i];tray.scene.add(m);bones.push(m);}makeBoard(2);$('loading').remove();$('begin').disabled=true;$('begin').textContent='Уралдаж эхлэх';$('result').textContent='Насны ангилал, замын зайгаа сонгоорой.';new ResizeObserver(resize).observe(board.host);new ResizeObserver(resize).observe(tray.host);
 function frame(now){if(throwMotion){const a=throwMotion,t=Math.min(1,(now-a.start)/a.duration),ease=1-Math.pow(1-t,3);bones.forEach((m,i)=>{m.position.x=(1.5-i)*1.28+Math.sin(t*Math.PI*4+i)*.18*(1-t);m.position.z=Math.sin(t*Math.PI*3+i)*.45*(1-t);const flight=.64;const bounce=t<flight?Math.sin(t/flight*Math.PI)*1.5:Math.abs(Math.sin((t-flight)/(1-flight)*Math.PI*3))*.38*(1-t)/(1-flight);m.position.y=.5+(reduced?0:bounce);m.rotation.set(reduced?0:(1-ease)*(Math.PI*4+i),0,sideAngles[a.faces[i]]+(reduced?0:(1-ease)*Math.PI*6));});if(t===1){throwMotion=null;a.resolve();}}
 if(turnMotion){const a=turnMotion,t=Math.min(1,(now-a.start)/a.duration),e=t*t*(3-2*t);a.horse.mesh.rotation.y=a.from+(a.to-a.from)*e;if(t===1){turnMotion=null;a.resolve();}}
 if(moveMotion){
  const a=moveMotion,t=Math.min(1,(now-a.start)/a.duration),e=t*t*(3-2*t),point=a.from.clone().lerp(a.to,e);
  a.horse.mesh.position.x=point.x;a.horse.mesh.position.z=point.z;a.horse.mesh.position.y=.43+(reduced?0:Math.sin(t*Math.PI)*.5);
  a.horse.mesh.rotation.y=facingRotation(a.fromPosition+(a.toPosition-a.fromPosition)*e,true);
  if(t===1){moveMotion=null;a.resolve();}
 }
 followCurrentHorse();board.renderer.render(board.scene,board.camera);tray.renderer.render(tray.scene,tray.camera);requestAnimationFrame(frame);}requestAnimationFrame(frame);return true;
 }catch(e){console.error(e);$('loading').textContent='3D дүрслэл ачаалсангүй. Хуудсыг дахин нээнэ үү.';$('begin').textContent='Ачаалж чадсангүй';}}
if(multiplayerMode){
 $('race-setup').hidden=true;$('new-game').disabled=true;
 $('result').textContent='Connecting to Horse Racing...';
 if(typeof io==='function'){multiplayer=createHorseMultiplayer({applyState:applyHorseState,renderControls:renderNetworkControls,cancelAnimations:cancelRaceAnimations,onStatus:text=>{$('result').textContent=text;}});mountGameSwitch(multiplayer);}
 else $('result').textContent='Server unavailable. Open the race through the multiplayer lobby.';
}
setupHandThrow({noun:'шагай',canThrow:()=>multiplayerMode?Boolean(multiplayer?.canThrow()):active&&!busy&&$('race-setup').hidden,throwDice:roll});
init().then(loaded=>{if(loaded){raceReady=true;$('begin').disabled=!isValidHorseRaceSelection($('horse-category').value,Number($('track-length').value));multiplayer?.ready();}});
