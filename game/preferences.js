export const DEV_TOOLS=import.meta.env?.VITE_ENABLE_DEV_TOOLS==='true';
export function readPreferences(){try{return {...{volume:1,showName:false,coaching:false,reduced:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false},...JSON.parse(localStorage.getItem('parry-grove-preferences')||'{}')};}catch{return {volume:1,showName:false,coaching:false,reduced:false};}}
