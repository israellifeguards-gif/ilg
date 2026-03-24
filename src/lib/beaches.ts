export interface Beach {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const BEACHES: Beach[] = [
  { id: 'tlv',       name: 'תל אביב – הילטון',    lat: 32.09, lng: 34.77 },
  { id: 'nahariya',  name: 'נהריה',                lat: 33.00, lng: 35.10 },
  { id: 'acre',      name: 'עכו',                  lat: 32.93, lng: 35.07 },
  { id: 'haifa',     name: 'חיפה – חוף הכרמל',    lat: 32.82, lng: 34.98 },
  { id: 'netanya',   name: 'נתניה',                lat: 32.33, lng: 34.85 },
  { id: 'herzliya',  name: 'הרצליה',               lat: 32.16, lng: 34.80 },
  { id: 'ashdod',    name: 'אשדוד',                lat: 31.80, lng: 34.65 },
  { id: 'ashkelon',  name: 'אשקלון',               lat: 31.67, lng: 34.57 },
  { id: 'eilat',     name: 'אילת – ים סוף',        lat: 29.55, lng: 34.95 },
];
