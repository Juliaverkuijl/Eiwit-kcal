self.addEventListener('push',event=>{
 let data={title:'Eiwit & Kcal',body:'Er is voeding toegevoegd aan het gezamenlijke dagboek.',url:'/'};
 try{if(event.data)data={...data,...event.data.json()}}catch{}
 event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:data.tag||'diary',data:{url:data.url||'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
 event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const c of clients){if(new URL(c.url).origin===self.location.origin){await c.focus();c.navigate(target);return}}await self.clients.openWindow(target)})());
});
