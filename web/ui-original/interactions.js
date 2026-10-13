// Presentation-only gesture lifecycle. Navigation and mutations remain with the caller.
export function bindSwipe(viewport, { onStep, threshold = 48, disabled = () => false } = {}) {
  const controller=new AbortController();let gesture=null,ignoreClick=false;
  viewport.addEventListener("pointerdown",event=>{
    if(disabled() || event.button!==0 || event.target.closest("input,select,textarea,[draggable=true]"))return;
    ignoreClick=false;gesture={id:event.pointerId,x:event.clientX,y:event.clientY};
  },{signal:controller.signal,passive:true});
  viewport.addEventListener("pointerup",event=>{
    if(!gesture || gesture.id!==event.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;gesture=null;
    if(Math.abs(dx)>=threshold && Math.abs(dx)>Math.abs(dy)*1.5) {ignoreClick=true;onStep?.(dx<0 ? 1 : -1,event);}
  },{signal:controller.signal,passive:true});
  viewport.addEventListener("pointercancel",()=>gesture=null,{signal:controller.signal});
  viewport.addEventListener("click",event=>{if(ignoreClick){ignoreClick=false;event.preventDefault();event.stopImmediatePropagation();}},{signal:controller.signal,capture:true});
  return ()=>{gesture=null;controller.abort();};
}
export function animateDateView(element,direction=0) {
  if(!element || element.ownerDocument?.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  return element.animate([{opacity:.3,transform:`translateX(${direction*14}px)`},{opacity:1,transform:"translateX(0)"}],{duration:180,easing:"ease-out"});
}
export function bindPitch(container, { onMove, onSelect, disabled = () => false } = {}) {
  const controller=new AbortController();let dragged=null,suppressClick=false;
  const end=()=>{if(dragged){container.classList.remove("lineup-dragging");dragged.node.classList.remove("selected");try{dragged.node.releasePointerCapture(dragged.pointer);}catch{}}dragged=null;};
  const move=(player,slot,event)=>onMove?.({player_id:player,slot_id:slot},event);
  container.addEventListener("pointerdown",event=>{
    const node=event.target.closest('[data-id][data-slot]');
    if(disabled() || event.button!==0 || node?.disabled || !node?.dataset.id || !container.contains(node))return;
    suppressClick=false;dragged={node,pointer:event.pointerId,id:node.dataset.id,x:event.clientX,y:event.clientY,moved:false};
  },{signal:controller.signal});
  container.addEventListener("pointermove",event=>{
    if(!dragged || dragged.pointer!==event.pointerId)return;
    if(!dragged.moved && Math.hypot(event.clientX-dragged.x,event.clientY-dragged.y)>8){dragged.moved=true;container.classList.add("lineup-dragging");dragged.node.classList.add("selected");try{dragged.node.setPointerCapture(event.pointerId);}catch{}}
    if(dragged.moved)event.preventDefault();
  },{signal:controller.signal});
  container.addEventListener("pointerup",event=>{
    if(!dragged || dragged.pointer!==event.pointerId)return;
    const current=dragged,target=container.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest("[data-slot]");
    if(current.moved){suppressClick=true;if(target && container.contains(target))move(current.id,target.dataset.slot,event);}
    end();
  },{signal:controller.signal});
  container.addEventListener("pointercancel",end,{signal:controller.signal});
  container.addEventListener("lostpointercapture",end,{signal:controller.signal});
  container.addEventListener("dragstart",event=>{
    const node=event.target.closest('[data-id][data-slot]');if(disabled() || node?.disabled || !node?.dataset.id){event.preventDefault();return;}
    end();event.dataTransfer.setData("text/plain",node.dataset.id);event.dataTransfer.effectAllowed="move";
  },{signal:controller.signal});
  container.addEventListener("dragover",event=>{if(!disabled() && event.target.closest("[data-slot]"))event.preventDefault();},{signal:controller.signal});
  container.addEventListener("drop",event=>{
    const target=event.target.closest("[data-slot]");if(disabled() || !target || !container.contains(target))return;
    event.preventDefault();const id=event.dataTransfer.getData("text/plain");if(id)move(id,target.dataset.slot,event);end();
  },{signal:controller.signal});
  container.addEventListener("dragend",end,{signal:controller.signal});
  container.addEventListener("click",event=>{
    if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();return;}
    const target=event.target.closest('[data-id][data-slot]');if(!disabled()&&!target?.disabled&&target&&container.contains(target))onSelect?.({player_id:target.dataset.id,slot_id:target.dataset.slot},event);
  },{signal:controller.signal,capture:true});
  return ()=>{end();controller.abort();};
}
