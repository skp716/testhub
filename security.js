export class SecurityMonitor{
  constructor({autoSubmitAfter=2,onViolation=()=>{},onForceSubmit=()=>{}}={}){this.limit=Math.max(1,autoSubmitAfter);this.onViolation=onViolation;this.onForceSubmit=onForceSubmit;this.count=0;this.active=false;this.lastAt=0;this.listeners=[];this.fullscreenArmed=false}
  add(target,event,handler,options){target.addEventListener(event,handler,options);this.listeners.push(()=>target.removeEventListener(event,handler,options))}
  start(){if(this.active)return;this.active=true;const block=(type,message)=>e=>{e?.preventDefault?.();this.report(type,message)};
    this.add(document,"contextmenu",block("context-menu","Right-click blocked"));
    this.add(document,"copy",block("copy","Copy blocked"));this.add(document,"cut",block("cut","Cut blocked"));this.add(document,"paste",block("paste","Paste blocked"));
    this.add(document,"visibilitychange",()=>{if(document.hidden)this.report("tab-hidden","Tab/app switch detected")});
    this.add(window,"blur",()=>{if(!document.hidden)this.report("window-blur","Exam window lost focus")});
    this.add(document,"fullscreenchange",()=>{if(this.fullscreenArmed&&!document.fullscreenElement)this.report("fullscreen-exit","Fullscreen exited")});
    this.add(document,"keydown",e=>{const k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&["p","s","u","c","x","v"].includes(k)){e.preventDefault();this.report(k==="p"?"print":"shortcut",`Blocked shortcut: ${k}`)}else if(e.key==="F12"||((e.ctrlKey||e.metaKey)&&e.shiftKey&&["i","j","c"].includes(k))){e.preventDefault();this.report("devtools","Developer-tools shortcut blocked")}});
    this.add(window,"beforeprint",()=>this.report("print","Print attempt detected"));
  }
  async requestFullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();this.fullscreenArmed=true}catch{this.report("fullscreen-denied","Fullscreen permission denied")}}
  async report(type,message){if(!this.active)return;const now=Date.now();if(now-this.lastAt<1500)return;this.lastAt=now;this.count++;await this.onViolation({type,message,at:now,count:this.count});if(this.count>=this.limit)this.onForceSubmit()}
  stop(){this.active=false;this.fullscreenArmed=false;this.listeners.splice(0).forEach(off=>off())}
}
