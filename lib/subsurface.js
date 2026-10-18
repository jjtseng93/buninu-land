// wl_subsurface state is separate from wl_surface's double-buffered content.
export function synchronized(surface) {
  for(let sub=surface.subsurface;sub;sub=sub.parent?.subsurface)if(sub.sync)return true;
  return false;
}
export function detachSubsurface(surface) {
  const sub=surface.subsurface;
  if(sub?.parent?.stack)sub.parent.stack=sub.parent.stack.filter(s=>s!==surface);
  surface.subsurface=null;
}
export function applySubsurfaces(parent) {
  for(const surface of parent.stack??[]){
    if(surface===parent)continue;
    const sub=surface.subsurface;if(!sub)continue;
    if(sub.pendingPosition){[sub.x,sub.y]=sub.pendingPosition;sub.pendingPosition=null;surface.dirty=true;}
    if(sub.pendingStack){
      const {sibling,above}=sub.pendingStack;sub.pendingStack=null;
      if(parent.stack.includes(sibling)){
        parent.stack=parent.stack.filter(s=>s!==surface);
        parent.stack.splice(parent.stack.indexOf(sibling)+(above?1:0),0,surface);surface.dirty=true;
      }
    }
    if(synchronized(surface)){
      if(surface.cached)applyCached(surface);
      else applySubsurfaces(surface);
    }
  }
}

function applyCached(surface) {
  const pending=surface.pending,cached=surface.cached;
  surface.pending=cached;surface.cached=null;
  try { surface.client.commit(surface,true); }
  catch(error){cached.snapshot?.dispose?.();throw error;}
  finally { surface.pending=pending; }
}
export function flushDesynchronized(surface) {
  if(synchronized(surface))return;
  if(surface.cached)applyCached(surface);
  for(const child of surface.stack??[])if(child!==surface)flushDesynchronized(child);
}
