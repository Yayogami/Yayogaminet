// Replace these short note patterns or this module when custom audio is supplied.
const sounds={join:[523,659],leave:[392,262],ready:[523,659,784],countdown:[660],turn:[440,554],reaction:[784,988]};
export function createGameAudio() {
  let context;
  const unlock=()=>{try{context??=new (window.AudioContext||window.webkitAudioContext)();context.resume().catch(()=>{});}catch{}};
  document.addEventListener('pointerdown',unlock);
  document.addEventListener('keydown',unlock);
  return {
    play(event) {
      if(context?.state!=='running')return;
      for(const [index,frequency] of (sounds[event]||[]).entries()) {
        const oscillator=context.createOscillator(),gain=context.createGain(),at=context.currentTime+index*0.12;
        oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(0.055,at+0.015);gain.gain.exponentialRampToValueAtTime(0.001,at+0.22);
        oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+0.24);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      }
    }
  };
}
