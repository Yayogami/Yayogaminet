export const browserSecurity = {
  randomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2,'0')).join('');
  },
  equalToken(a,b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let difference=0;
    for(let index=0;index<a.length;index++) difference |= a.charCodeAt(index)^b.charCodeAt(index);
    return difference===0;
  },
};
