export const HORSE_AGE_CATEGORIES = Object.freeze([
  { id: 'azarga', name: 'Азарга', minKm: 22, maxKm: 24 },
  { id: 'ikh-nas', name: 'Их нас', minKm: 24, maxKm: 26 },
  { id: 'soyolon', name: 'Соёолон', minKm: 18, maxKm: 20 },
  { id: 'hyzaalan', name: 'Хязаалан', minKm: 15, maxKm: 17 },
  { id: 'shudlen', name: 'Шүдлэн', minKm: 12, maxKm: 14 },
  { id: 'daaga', name: 'Даага', minKm: 10, maxKm: 12 }
].map(Object.freeze));

export const HORSE_TRACK_SPACING = 1;
export const HORSE_TRACK_MARKER_SCALE = 1.05;
export const HORSE_TRACK_CAMERA_HEIGHT = 13;

export function horseTrackCameraFrame(aspectRatio) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError('Camera aspect ratio must be positive.');
  }
  return { width: HORSE_TRACK_CAMERA_HEIGHT * aspectRatio, height: HORSE_TRACK_CAMERA_HEIGHT };
}

export function horseFinishPosition(trackLength) {
  if (!Number.isInteger(trackLength) || trackLength < 1) {
    throw new RangeError('Track length must be a positive integer.');
  }
  return trackLength + 1;
}

export function horseProgressLabel(position, trackLength, finished = false) {
  if (finished || position >= horseFinishPosition(trackLength)) return 'Барианд';
  if (position === trackLength) return `Сүүлийн шагай · ${trackLength} / ${trackLength}`;
  return `${position} / ${trackLength} шагай`;
}

const placeNumbers = Object.freeze([
  '', '', '', 'гурав', 'дөрөв', 'тав', 'зургаа', 'долоо',
  'найм', 'ес', 'арав', 'арван нэг', 'арван хоёр'
]);

export function horseTrackOptions(categoryId) {
  const category = HORSE_AGE_CATEGORIES.find(item => item.id === categoryId);
  if (!category) return [];
  return Array.from({ length: category.maxKm - category.minKm + 1 }, (_, index) => {
    const kilometers = category.minKm + index;
    return { kilometers, trackLength: kilometers * 2 };
  });
}

export function isValidHorseRaceSelection(categoryId, trackLength) {
  return Number.isInteger(trackLength) &&
    horseTrackOptions(categoryId).some(option => option.trackLength === trackLength);
}

export function finishTitle(place) {
  if (place === 1) return 'Түрүү магнай';
  if (place === 2) return 'Аман хүзүү';
  if (place >= 3 && place <= 5) return `Айргийн ${placeNumbers[place]}`;
  if (place >= 6 && place <= 12) return `Цулбуурын ${placeNumbers[place]}`;
  return null;
}

export function foalLastPlaceAnnouncement(categoryId, finishOrder, playerCount, raceFinished) {
  if (categoryId !== 'daaga' || !raceFinished || playerCount < 1 ||
      !Array.isArray(finishOrder) || finishOrder.length !== playerCount ||
      new Set(finishOrder).size !== playerCount) return null;
  return 'Энэ тоглолтын баян ходоод, ирэх тоглолтын түрүү магнай!';
}

export function buildHorseTrackPath(length, spacing = HORSE_TRACK_SPACING) {
  if (!Number.isInteger(length) || length < 1 || !Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError('Track length and spacing must be positive.');
  }
  const curves = Math.max(2, Math.round(length / 10));
  const bend = 0.52;
  const points = [{ x: 0, z: 0 }];
  for (let step = 1; step <= length; step++) {
    const angle = bend * Math.sin(2 * Math.PI * curves * (step - 0.5) / length);
    const previous = points[step - 1];
    points.push({
      x: previous.x + spacing * Math.cos(angle),
      z: previous.z + spacing * Math.sin(angle)
    });
  }
  const centerX = (points[0].x + points[length].x) / 2;
  const centerZ = (Math.min(...points.map(point => point.z)) + Math.max(...points.map(point => point.z))) / 2;
  return points.map(point => ({ x: point.x - centerX, z: point.z - centerZ }));
}

export function buildHorseTrackLayout(trackLength) {
  const finishPosition = horseFinishPosition(trackLength);
  return {
    markerPositions: Array.from({ length: trackLength }, (_, index) => index + 1),
    finishPosition,
    path: buildHorseTrackPath(finishPosition)
  };
}

export function advance(horse,faces,length){
 const horses=faces.filter(x=>x===0).length;
 const different=new Set(faces).size===4;
 const firstThrow=!horse.hasThrown;
 const turnedForward=!horse.facingForward&&horses>0;
 const facingForward=horse.facingForward||turnedForward;
 const steps=different?4:turnedForward?Math.max(0,horses-1):horses;
 const finishPosition=horseFinishPosition(length);
 return {horses,different,firstThrow,turnedForward,facingForward,steps,finishPosition,position:Math.min(finishPosition,horse.position+steps)};
}

export function hasHorseMovement(fromPosition,toPosition){
 return fromPosition!==toPosition;
}
