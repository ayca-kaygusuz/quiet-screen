import {validReleaseInfo} from './library.mjs'

export function createReleaseCatalog({fetcher=fetch,clock=Date.now}={}) {
  const cache=new Map(), pending=new Map()
  let queue=Promise.resolve()
  async function json(url) {
    const work=queue.then(async()=>{
      const response=await fetcher(url,{signal:AbortSignal.timeout(12000)})
      if(response.status===404)return null
      if(!response.ok)throw Error('Release lookup failed')
      const text=await response.text()
      if(text.length>8*1024*1024)throw Error('Release response too large')
      return JSON.parse(text)
    })
    queue=work.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,550)))
    return work
  }
  return async imdb=>{
    if(!/^tt\d{7,}$/.test(imdb))throw Error('Invalid IMDb ID')
    if(cache.has(imdb)&&clock()-cache.get(imdb).checkedAt<6*3600000)return cache.get(imdb)
    if(pending.has(imdb))return pending.get(imdb)
    const work=(async()=>{
      const show=await json('https://api.tvmaze.com/lookup/shows?imdb='+imdb)
      if(show&&(!Number.isSafeInteger(show.id)||show.id<1||show.externals?.imdb!==imdb))throw Error('Release title mismatch')
      const raw=show?await json('https://api.tvmaze.com/shows/'+show.id+'/episodes'):[]
      if(!Array.isArray(raw)||raw.length>10000)throw Error('Invalid release episodes')
      const result={imdb,checkedAt:clock(),show:show?.id??null,ended:show?.status==='Ended',episodes:raw.filter(e=>Number.isInteger(e.number)&&e.number>0&&Number.isInteger(e.season)&&e.season>0).map(e=>({
        season:e.season,episode:e.number,name:typeof e.name==='string'?e.name.slice(0,300):'',
        airdate:e.airdate||null,airstamp:e.airstamp||null,
      }))}
      if(!validReleaseInfo(result))throw Error('Invalid release metadata')
      cache.set(imdb,result)
      if(cache.size>500)cache.delete(cache.keys().next().value)
      return result
    })().finally(()=>pending.delete(imdb))
    pending.set(imdb,work)
    return work
  }
}

export async function releaseResponse(url,catalog) {
  const imdb=url.searchParams.get('id')??''
  if(!/^tt\d{7,}$/.test(imdb))return Response.json({error:'Invalid IMDb ID'},{status:400})
  try{return Response.json(await catalog(imdb),{headers:{'Cache-Control':'no-store'}})}
  catch{return Response.json({error:'Episode release dates could not be checked. Try again when online.'},{status:502})}
}
