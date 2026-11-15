
/* Eiwit & Kcal: offline app shell + push, no API caching. */
const CACHE='eiwit-app-shell-2026-11-16-v1';
const APP=['./','./index.html'];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.add('./index.html');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys.filter(k=>k.startsWith('eiwit-app-shell-')&&k!==CACHE)
        .map(k=>caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req);
        if(res.ok){
          const cache=await caches.open(CACHE);
          await cache.put('./index.html',res.clone());
        }
        return res;
      }catch{
        const cache=await caches.open(CACHE);
        return (await cache.match('./index.html'))||Response.error();
      }
    })());
  }
});

self.addEventListener('push',event=>{
  let data={};
  try{
    data=event.data?.json()||{};
  }catch{
    data={body:event.data?.text()||''};
  }

  const title=data.title||data.notification?.title||'Eiwit & Kcal';
  const options={
    body:data.body||data.notification?.body||'Je hebt een nieuwe melding.',
    icon:'/icon-192.png',
    badge:'/icon-192.png',
    tag:data.tag||'eiwit-update',
    data:{url:data.url||data.notification?.url||'/'}
  };

  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(
      event.notification.data?.url||'/',
      self.location.origin
    );
    if(target.origin!==self.location.origin)return;

    const windows=await self.clients.matchAll({
      type:'window',
      includeUncontrolled:true
    });

    for(const client of windows){
      if(new URL(client.url).origin===target.origin){
        await client.focus();
        return;
      }
    }

    await self.clients.openWindow(target.href);
  })());
});
