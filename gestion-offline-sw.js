/* Gestion-Argent : fonctionnement hors connexion */

const CACHE='gestion-argent-offline-2026-11-v1';
const PREFIX='gestion-argent-offline-';

const indexUrl=new URL(
  './index.html',
  self.registration.scope
).href;

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);

    try {
      const response=await fetch(
        indexUrl,
        {cache:'reload'}
      );

      if (response.ok) {
        await cache.put(
          indexUrl,
          response.clone()
        );

        const html=await response.text();

        const paths=[
          './',
          './index.html',
          ...Array.from(
            html.matchAll(
              /(?:src|href)=["']([^"'#]+)["']/g
            ),
            m=>m[1]
          )
        ];

        await Promise.all(
          paths.map(async path=>{
            try {
              const url=new URL(
                path,
                self.registration.scope
              );

              if (
                url.origin!==location.origin ||
                !url.href.startsWith(
                  self.registration.scope
                )
              ) return;

              const res=await fetch(
                url,
                {cache:'reload'}
              );

              if (res.ok) {
                await cache.put(
                  url.href,
                  res.clone()
                );
              }
            } catch(_) {}
          })
        );
      }
    } catch(_) {}

    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();

    await Promise.all(
      keys
        .filter(k=>
          k.startsWith(PREFIX) &&
          k!==CACHE
        )
        .map(k=>caches.delete(k))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);

  if (
    request.method!=='GET' ||
    url.origin!==location.origin ||
    !url.href.startsWith(
      self.registration.scope
    )
  ) return;

  event.respondWith((async()=>{
    try {
      const response=await fetch(request);

      if (response.ok) {
        const cache=await caches.open(CACHE);

        await cache.put(
          request,
          response.clone()
        );
      }

      return response;

    } catch(error) {
      const cache=await caches.open(CACHE);

      return (
        await cache.match(request) ||
        (
          request.mode==='navigate'
            ? await cache.match(indexUrl)
            : null
        ) ||
        Response.error()
      );
    }
  })());
});
