import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type User={id:number;username:string};
type Video={name:string;title:string;path:string;episode?:{season:number;episode:number;label:string}|null};
type Folder={name:string;path:string};
type FolderData={path:string;name:string;breadcrumbs:string[];folders:Folder[];videos:Video[]};
type Resume={path:string;watched_at:number;position:number;duration:number;completed:number};
type Track={name:string;path:string;language:string;format:string};

const get=async(url:string,opts?:RequestInit)=>{const r=await fetch(url,{credentials:"same-origin",...opts});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`Request failed (${r.status})`);return r.json()};
const fmt=(n:number)=>{n=Math.max(0,Math.floor(n||0));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`};
const enc=(s:string)=>encodeURIComponent(s);
const thumb=(p:string)=>`/api/thumb?path=${enc(p)}`;

function App(){
 const [user,setUser]=useState<User|null>(null),[login,setLogin]=useState(true),[username,setUsername]=useState(""),[password,setPassword]=useState(""),[loginError,setLoginError]=useState("");
 const [page,setPage]=useState<"library"|"continue"|"history"|"favorites">("library"),[folder,setFolder]=useState<FolderData|null>(null),[path,setPath]=useState(""),[current,setCurrent]=useState<Video|null>(null),[sidebar,setSidebar]=useState(false),[query,setQuery]=useState("");
 const [continueItems,setContinueItems]=useState<Resume[]>([]),[history,setHistory]=useState<Resume[]>([]),[favorites,setFavorites]=useState<Resume[]>([]),[favorite,setFavorite]=useState(false);
 const [tracks,setTracks]=useState<Track[]>([]),[subtitle,setSubtitle]=useState("off"),[error,setError]=useState("");
 const videoRef=useRef<HTMLVideoElement>(null),saveRef=useRef<number|undefined>();
 const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[volume,setVolume]=useState(1),[speed,setSpeed]=useState(1),[resume,setResume]=useState(0);

 const refreshHome=useCallback(async()=>{try{setContinueItems((await get("/api/continue")).items);setHistory((await get("/api/history")).items);setFavorites((await get("/api/favorites")).items)}catch{}},[]);
 useEffect(()=>{get("/api/auth/me").then((x)=>{setUser(x.user);setLogin(false)}).catch(()=>setLogin(true))},[]);
 useEffect(()=>{if(user)refreshHome()},[user,refreshHome]);

 const loadFolder=useCallback(async(p:string)=>{setError("");try{setFolder(await get(`/api/folders?path=${enc(p)}`));setPath(p);setPage("library")}catch(e:any){setError(e.message)}},[]);
 useEffect(()=>{if(user)loadFolder("")},[user,loadFolder]);

 const openVideo=useCallback(async(v:Video)=>{setCurrent(v);setPage("library");setError("");try{const info=await get(`/api/video/info?path=${enc(v.path)}`);setFavorite(info.favorite);setResume(info.progress||0);setTracks((await get(`/api/subtitles?path=${enc(v.path)}`)).tracks||[])}catch(e:any){setError(e.message)}},[]);
 const currentIndex=folder?.videos.findIndex(v=>v.path===current?.path)??-1;
 const siblings=folder?.videos||[];
 const next=currentIndex>=0?siblings[currentIndex+1]:undefined,prev=currentIndex>0?siblings[currentIndex-1]:undefined;

 const save=useCallback((completed=false)=>{if(!current||!videoRef.current)return;const v=videoRef.current;if(!v.duration)return;const body={path:current.path,position:v.currentTime,duration:v.duration,completed};fetch("/api/progress",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(body)}).catch(()=>{})},[current]);
 useEffect(()=>{const f=()=>save();window.addEventListener("beforeunload",f);return()=>{window.removeEventListener("beforeunload",f);save()}},[save]);
 useEffect(()=>{if(!current)return;const id=window.setInterval(()=>save(),10000);return()=>clearInterval(id)},[current,save]);

 const play=()=>{const v=videoRef.current;if(!v)return;v.paused?v.play().catch(()=>{}):v.pause()};
 const seek=(d:number)=>{const v=videoRef.current;if(v){v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+d));setTime(v.currentTime);save()}};
 const selectPage=async(p:typeof page)=>{setPage(p);setCurrent(null);setSidebar(false);setQuery("");if(p==="continue")setContinueItems((await get("/api/continue")).items);if(p==="history")setHistory((await get("/api/history")).items);if(p==="favorites")setFavorites((await get("/api/favorites")).items)};
 const logout=async()=>{await get("/api/auth/logout",{method:"POST"}).catch(()=>{});setUser(null);setLogin(true)};
 const doLogin=async(e:any)=>{e.preventDefault();setLoginError("");try{const x=await get("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});setUser(x.user);setLogin(false);setPassword("")}catch(e:any){setLoginError(e.message)}};
 const toggleFavorite=async()=>{if(!current)return;const x=await get("/api/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:current.path})});setFavorite(x.favorite);refreshHome()};
 const findVideo=async(p:string)=>{const name=p.split("/").pop()||p;await openVideo({name,title:name.replace(/\.[^.]+$/,""),path:p})};
 const removeHistory=async(p:string)=>{await get(`/api/history?path=${enc(p)}`,{method:"DELETE"});refreshHome();if(page==="history")setHistory((await get("/api/history")).items)};

 const visible=useMemo(()=>{if(!folder)return[];const q=query.toLowerCase().trim();return q?folder.videos.filter(v=>v.name.toLowerCase().includes(q)):folder.videos},[folder,query]);

 if(login)return <div className="login-page"><div className="login-card"><div className="logo">▶</div><h1>VPS Video Library</h1><p>Private media streaming</p><form onSubmit={doLogin}><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label>{loginError&&<div className="login-error">{loginError}</div>}<button className="primary">Sign in</button></form></div></div>;

 const cards=(items:Resume[])=>items.map(x=><button className="media-card" key={x.path} onClick={()=>findVideo(x.path)}><img src={thumb(x.path)} onError={e=>(e.currentTarget.style.display="none")} /><div className="media-info"><b>{x.path.split("/").pop()}</b><small>{x.path}</small><div className="progress"><i style={{width:`${x.duration?Math.min(100,x.position/x.duration*100):0}%`}}/></div><small>{fmt(x.position)}{x.duration?` / ${fmt(x.duration)}`:""}</small></div><span>›</span></button>);

 return <div className="app">
  <header><button className="hamb" onClick={()=>setSidebar(!sidebar)}>☰</button><div className="brand"><span>▶</span> VPS Video Library</div><div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search this folder…"/></div><button className="refresh" onClick={()=>loadFolder(path)}>↻</button><button className="user" onClick={logout}>↪ {user?.username}</button></header>
  <div className="layout">
   <aside className={sidebar?"show":""}><div className="nav-title">LIBRARY</div><button className={page==="library"&&!path?"nav active":"nav"} onClick={()=>{loadFolder("");setSidebar(false)}}>⌂ All videos</button><button className={page==="continue"?"nav active":"nav"} onClick={()=>selectPage("continue")}>▶ Continue Watching</button><button className={page==="favorites"?"nav active":"nav"} onClick={()=>selectPage("favorites")}>♡ Favorites</button><button className={page==="history"?"nav active":"nav"} onClick={()=>selectPage("history")}>◷ Watch History</button><div className="nav-title folders">FOLDERS</div>{folder?.folders.map(f=><button className="nav" key={f.path} onClick={()=>{loadFolder(f.path);setSidebar(false)}}>▰ <span>{f.name}</span></button>)}</aside>
   <main>
    {error&&<div className="error">{error}</div>}
    {current?<Watch current={current} favorite={favorite} toggleFavorite={toggleFavorite} tracks={tracks} subtitle={subtitle} setSubtitle={setSubtitle} videoRef={videoRef} time={time} setTime={setTime} duration={duration} setDuration={setDuration} playing={playing} setPlaying={setPlaying} volume={volume} setVolume={setVolume} speed={speed} setSpeed={setSpeed} resume={resume} save={save} seek={seek} next={next} prev={prev} openVideo={openVideo} back={()=>setCurrent(null)}/>:page==="library"?<Library folder={folder} visible={visible} loadFolder={loadFolder} openVideo={openVideo}/>:<div className="page"><div className="page-head"><div className="eyebrow">{page==="continue"?"PICK UP WHERE YOU LEFT OFF":page==="favorites"?"YOUR SAVED VIDEOS":"RECENTLY WATCHED"}</div><h1>{page==="continue"?"Continue Watching":page==="favorites"?"Favorites":"Watch History"}</h1></div>{page==="continue"?<div className="shelf">{cards(continueItems)}</div>:page==="favorites"?<div className="shelf">{favorites.map(x=><button className="media-card" key={x.path} onClick={()=>findVideo(x.path)}><img src={thumb(x.path)}/><div className="media-info"><b>{x.path.split("/").pop()}</b><small>{x.path}</small></div><span>›</span></button>)}</div>:<div className="shelf">{history.map(x=><div className="history-row" key={x.path}><button className="history-main" onClick={()=>findVideo(x.path)}><img src={thumb(x.path)}/><div className="media-info"><b>{x.path.split("/").pop()}</b><small>{x.path}</small><small>{x.completed?"Completed":`${fmt(x.position)} / ${fmt(x.duration)}`}</small></div></button><button className="delete" onClick={()=>removeHistory(x.path)}>×</button></div>)}</div>}</div>}
   </main>
  </div>
 </div>
}

function Library({folder,visible,loadFolder,openVideo}:{folder:FolderData|null;visible:Video[];loadFolder:(p:string)=>void;openVideo:(v:Video)=>void}){return <div className="page"><div className="crumb"><button onClick={()=>loadFolder("")}>Library</button>{folder?.breadcrumbs.map((x,i)=><span key={x}> / <button onClick={()=>loadFolder(folder.breadcrumbs.slice(0,i+1).join("/"))}>{x}</button></span>)}</div><div className="page-head"><div className="eyebrow">YOUR MEDIA</div><h1>{folder?.name||"Library"}</h1><p>{folder?.videos.length||0} videos · {folder?.folders.length||0} folders</p></div><div className="grid">{folder?.folders.map(f=><button className="folder-card" key={f.path} onClick={()=>loadFolder(f.path)}><span>▰</span><b>{f.name}</b><i>›</i></button>)}{visible.map(v=><button className="video-card" key={v.path} onClick={()=>openVideo(v)}><img src={thumb(v.path)}/><div><b>{v.title}</b><small>{v.episode?.label||"Video"}</small></div><i>›</i></button>)}</div></div>}

function Watch({current,favorite,toggleFavorite,tracks,subtitle,setSubtitle,videoRef,time,setTime,duration,setDuration,playing,setPlaying,volume,setVolume,speed,setSpeed,resume,save,seek,next,prev,openVideo,back}:{current:Video;favorite:boolean;toggleFavorite:()=>void;tracks:Track[];subtitle:string;setSubtitle:(s:string)=>void;videoRef:any;time:number;setTime:any;duration:number;setDuration:any;playing:boolean;setPlaying:any;volume:number;setVolume:any;speed:number;setSpeed:any;resume:number;save:(c?:boolean)=>void;seek:(d:number)=>void;next?:Video;prev?:Video;openVideo:(v:Video)=>void;back:()=>void}){
 const full=()=>document.querySelector(".player")?.requestFullscreen?.();
 const pip=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await videoRef.current?.requestPictureInPicture()}catch{}};
 const speedUp=()=>{const a=[.5,.75,1,1.25,1.5,1.75,2],n=a[(a.indexOf(speed)+1)%a.length];setSpeed(n);if(videoRef.current)videoRef.current.playbackRate=n};
 const setSub=(value:string)=>{setSubtitle(value);const v=videoRef.current;if(!v)return;Array.from(v.textTracks).forEach((t:any,i)=>t.mode=(i===Number(value))?"showing":"disabled");};
 return <div className="watch">
  <div className="player"><video ref={videoRef} src={`/stream?path=${enc(current.path)}`} autoPlay onLoadedMetadata={(e:any)=>{setDuration(e.currentTarget.duration);if(resume>5&&resume<e.currentTarget.duration-5)e.currentTarget.currentTime=resume}} onTimeUpdate={(e:any)=>{setTime(e.currentTarget.currentTime);if(Math.floor(e.currentTarget.currentTime)%10===0)save()}} onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);save()}} onEnded={()=>save(true)} playsInline>{tracks.map((t,i)=><track key={t.path} kind="subtitles" src={`/subtitles?path=${enc(t.path)}`} srcLang={t.language} label={t.language.toUpperCase()} />)}</video>
   <div className="player-ui"><button className="big" onClick={()=>{const v=videoRef.current;v?.paused?v.play():v?.pause()}}>{playing?"Ⅱ":"▶"}</button>
    <div className="bar"><button onClick={()=>seek(-10)}>↶10</button><button onClick={()=>seek(10)}>10↷</button><span>{fmt(time)} / {fmt(duration)}</span><input type="range" min="0" max={duration||0} value={time} onChange={e=>{videoRef.current.currentTime=+e.target.value;setTime(+e.target.value);save()}}/><button onClick={()=>{const v=videoRef.current;v.muted=!v.muted;setVolume(v.muted?0:v.volume)}}>{volume?"🔊":"🔇"}</button><input className="vol" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>{const n=+e.target.value;setVolume(n);videoRef.current.volume=n;videoRef.current.muted=n===0}}/><button onClick={speedUp}>{speed}×</button>{tracks.length>0&&<select className="cc" value={subtitle} onChange={e=>setSub(e.target.value)}><option value="off">CC Off</option>{tracks.map((t,i)=><option key={t.path} value={String(i)}>{t.language.toUpperCase()}</option>)}</select>}<button onClick={pip}>▣</button><button onClick={full}>⛶</button></div>
   </div>
  </div>
  <div className="watch-head"><div><div className="eyebrow">NOW PLAYING</div><h1>{current.title}</h1><p>{current.episode?.label||current.path}</p></div><button className={favorite?"fav active":"fav"} onClick={toggleFavorite}>{favorite?"♥":"♡"} {favorite?"Favorite":"Add to favorites"}</button></div>
  {(prev||next)&&<div className="episode-nav">{prev&&<button onClick={()=>openVideo(prev)}>← {prev.episode?.label||"Previous"}</button>}<span>{current.episode?.label||"VIDEO"}</span>{next&&<button onClick={()=>openVideo(next)}>{next.episode?.label||"Next"} →</button>}</div>}
  <div className="next-title">UP NEXT</div>{next?<button className="next-pill" onClick={()=>openVideo(next)}><span>{next.episode?.label||"NEXT"}</span><b>{next.title}</b><i>›</i></button>:<div className="muted">End of this folder.</div>}
  <button className="back" onClick={back}>← Back to library</button>
 </div>
}

export default App;
