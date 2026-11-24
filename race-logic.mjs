export function advance(horse,faces,length){
 const horses=faces.filter(x=>x===0).length;
 const different=new Set(faces).size===4;
 const firstThrow=!horse.hasThrown;
 const turnedForward=!horse.facingForward&&horses>0;
 const facingForward=horse.facingForward||turnedForward;
 const steps=different?4:turnedForward?Math.max(0,horses-1):horses;
 return {horses,different,firstThrow,turnedForward,facingForward,steps,position:Math.min(length,horse.position+steps)};
}

export function hasHorseMovement(fromPosition,toPosition){
 return fromPosition!==toPosition;
}
