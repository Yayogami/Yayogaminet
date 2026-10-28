// Three public routing characters and seven random PAKE-secret characters.
// The full code is private; it is not a 256-bit secret or a durable identity.
export const COMPACT_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function normalizeCompactCode(input) {
 if (typeof input !== 'string' || input.length > 32) throw Error('Invalid ten-character code');
 const pasted = input.trim().replace(/^#/, '');
 if (!/^[0-9A-Za-z]{10}$/.test(pasted)) throw Error('Invalid ten-character code');
 const code = pasted.toLowerCase();
 if (code.length !== 10 || [...code].some(c => !COMPACT_ALPHABET.includes(c)) || code.slice(0,3) === '000') throw Error('Invalid ten-character code');
 return code;
}
