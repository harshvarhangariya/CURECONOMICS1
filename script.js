/* CUREECONOMICS — browser-side interactive engine
   Works on GitHub Pages. Three.js/GSAP are optional; canvas fallback is built in. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (x, n=3) => Number.isFinite(x) ? x.toFixed(n) : "—";
  const sampleT = [0,1,2,4,6,8,10,12];
  const sampleY = [10,15.5,23.2,45.1,69.1,85.8,94.3,97.8];
  const colors = {L:"#45c9ff", G:"#ad8cff", O:"#ffbd69", grid:"rgba(125,151,205,.18)", text:"#aab8d8"};
  const state = {kind:"L", fit:null, horizon:5, comparison:{K:100,r:.5,N0:10}, views:new WeakMap()};
  const logistic = (t,K,r,A) => K/(1+A*Math.exp(-r*t));
  const gompertz = (t,K,r,A) => K*Math.exp(-A*Math.exp(-r*t));
  const predict = (kind,t,p) => kind==="L" ? logistic(t,p.K,p.r,p.A) : gompertz(t,p.K,p.r,p.A);
  const parseList = s => s.split(/[,\s;]+/).filter(Boolean).map(Number);
  const sum = a => a.reduce((x,y)=>x+y,0);
  const mean = a => sum(a)/a.length;

  function fitModel(kind, ts, ys) {
    const minY=Math.min(...ys), maxY=Math.max(...ys), span=Math.max(1,maxY-minY);
    const t0=ts[0], tSpan=Math.max(1,ts[ts.length-1]-t0);
    let best=null;
    // Deterministic multiscale grid search over K and r; A is determined by first observation.
    const kMin=Math.max(maxY*1.002, minY+span*.15);
    const kMax=Math.max(kMin+span, maxY*5, maxY+span*5);
    const rMin=.003/tSpan, rMax=8/tSpan;
    const evaluate=(K,r)=>{
      const n0=clamp(ys[0],1e-8,K*.999999);
      const A=kind==="L"?(K-n0)/n0:Math.log(K/n0);
      const p={K,r,A};
      const err=ts.reduce((s,t,i)=>s+(predict(kind,t-t0,p)-ys[i])**2,0);
      if(Number.isFinite(err)&&(!best||err<best.sse)) best={...p,sse:err,kind,t0};
    };
    // Coarse global scan
    for(let i=0;i<=90;i++){
      const K=kMin+(kMax-kMin)*i/90;
      for(let j=0;j<=100;j++){
        const r=rMin*Math.pow(rMax/rMin,j/100);
        evaluate(K,r);
      }
    }
    // Local refinement around the best point
    for(let pass=0;pass<4;pass++){
      const kRadius=(kMax-kMin)*Math.pow(.16,pass+1);
      const rRadius=Math.pow(5,1/(pass+1));
      const center=best;
      for(let i=-12;i<=12;i++) for(let j=-12;j<=12;j++){
        const K=clamp(center.K+i*kRadius/12,kMin,kMax);
        const r=clamp(center.r*Math.pow(rRadius,j/12),rMin,rMax);
        evaluate(K,r);
      }
    }
    const fitted=ts.map(t=>predict(kind,t-t0,best));
    const residual=ys.map((y,i)=>y-fitted[i]);
    const mse=mean(residual.map(x=>x*x)), rmse=Math.sqrt(mse), mae=mean(residual.map(Math.abs));
    const ssTot=sum(ys.map(y=>(y-mean(ys))**2));
    const r2=ssTot===0?1:1-best.sse/ssTot;
    return {...best,rmse,mae,r2,fitted};
  }

  function canvasSetup(canvas) {
    if(!canvas) return null;
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
    const w=Math.max(1,rect.width), h=Math.max(1,rect.height);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
    }
    const c=canvas.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0);
    return {c,w,h};
  }
  function line(c, pts, color, width=2, dash=[]) {
    if(!pts.length)return; c.beginPath(); c.setLineDash(dash); c.lineWidth=width;c.strokeStyle=color;
    pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();c.setLineDash([]);
  }
  function chart(canvas, ts, ys, fitL, fitG, horizon=0) {
    const s=canvasSetup(canvas); if(!s)return; const {c,w,h}=s;
    c.clearRect(0,0,w,h); c.fillStyle="rgba(5,8,20,.28)";c.fillRect(0,0,w,h);
    const allT=[...ts]; if(horizon) for(let i=1;i<=horizon;i++)allT.push(ts[ts.length-1]+i*(ts.length>1?(ts[ts.length-1]-ts[0])/(ts.length-1):1));
    const x0=Math.min(...allT), x1=Math.max(...allT), y0=Math.min(0,...ys)*.9, y1=Math.max(...ys)*1.14;
    const X=t=>48+(t-x0)/Math.max(1e-9,x1-x0)*(w-68), Y=y=>h-34-(y-y0)/Math.max(1e-9,y1-y0)*(h-58);
    c.font="11px monospace"; c.fillStyle=colors.text; c.strokeStyle=colors.grid; c.lineWidth=1;
    for(let i=0;i<=5;i++){let y=35+i*(h-70)/5;c.beginPath();c.moveTo(44,y);c.lineTo(w-18,y);c.stroke();c.fillText(fmt(y1-(y-35)/(h-70)*(y1-y0),0),5,y+4);}
    for(let i=0;i<=5;i++){let x=48+i*(w-68)/5;c.beginPath();c.moveTo(x,18);c.lineTo(x,h-34);c.stroke();c.fillText(fmt(x0+i*(x1-x0)/5,1),x-8,h-12);}
    const drawFit=(fit,color)=>{
      if(!fit)return; const end=x1, start=x0, pts=[];
      for(let i=0;i<=180;i++){let t=start+(end-start)*i/180;pts.push({x:X(t),y:Y(predict(fit.kind,t-fit.t0,fit))});}
      line(c,pts,color,2.6);
      if(horizon){const p0={x:X(ts[ts.length-1]),y:Y(predict(fit.kind,ts[ts.length-1]-fit.t0,fit))};const p1={x:X(end),y:Y(predict(fit.kind,end-fit.t0,fit))};line(c,[p0,p1],color,1.5,[5,5]);}
    };
    drawFit(fitL,colors.L);drawFit(fitG,colors.G);
    c.fillStyle=colors.O;ts.forEach((t,i)=>{c.beginPath();c.arc(X(t),Y(ys[i]),4,0,Math.PI*2);c.fill();});
    c.font="12px sans-serif";c.fillStyle=colors.L;c.fillText("Logistic",w-170,18);c.fillStyle=colors.G;c.fillText("Gompertz",w-105,18);c.fillStyle=colors.O;c.fillText("Observed",w-42,18);
  }

  function setText(id, value){const el=$(id);if(el)el.textContent=value;}
  function renderResults(ts,ys,L,G,horizon){
    const winner=L.rmse<=G.rmse?"Logistic":"Gompertz";
    setText("resultTitle",winner+" model fits better");setText("resultSub",`${ts.length} observations · lower RMSE indicates closer fit`);
    setText("status","ANALYSIS COMPLETE");
    const metrics=$("metricGrid"), params=$("paramGrid");
    if(metrics)metrics.innerHTML=[
      ["Logistic RMSE",fmt(L.rmse),L.rmse<=G.rmse],["Gompertz RMSE",fmt(G.rmse),G.rmse<L.rmse],
      ["Logistic MAE",fmt(L.mae),false],["Gompertz MAE",fmt(G.mae),false],
      ["Logistic R²",fmt(L.r2),false],["Gompertz R²",fmt(G.r2),false],
      ["Best fit",winner,true],["Observations",String(ts.length),false]
    ].map(([a,b,win])=>`<div class="metric ${win?"win":""}"><small>${a}</small><b>${b}</b><span>${a.includes("RMSE")?"Root mean squared error":a.includes("MAE")?"Mean absolute error":a.includes("R²")?"Coefficient of determination":"Computed from your data"}</span></div>`).join("");
    if(params)params.innerHTML=[["LOGISTIC",L],["GOMPERTZ",G]].map(([name,p])=>`<div class="pcard ${p=== (winner==="Logistic"?L:G)?"win":""}"><small>${name} PARAMETERS</small><p>K = ${fmt(p.K)}<br>r = ${fmt(p.r,5)}<br>A = ${fmt(p.A)}</p></div>`).join("");
    const list=$("forecastList"), caption=$("forecastCaption");
    if(list){list.innerHTML="";for(let i=1;i<=horizon;i++){const t=ts[ts.length-1]+i*(ts.length>1?(ts[ts.length-1]-ts[0])/(ts.length-1):1);const v=predict(winner==="Logistic"?"L":"G",t-(winner==="Logistic"?L.t0:G.t0),winner==="Logistic"?L:G);const span=document.createElement("span");span.className="chip";span.textContent=`t=${fmt(t,2)} · ${fmt(v,2)}`;list.append(span);}}
    if(caption)caption.textContent=`${winner} forecast · ${horizon} future steps`;
    chart($("growthChart"),ts,ys,L,G,horizon);
    state.fit={ts,ys,L,G};
  }
  function analyze(){
    const error=$("errorBox"); if(error)error.hidden=true;
    const ts=parseList($("times")?.value||""), ys=parseList($("values")?.value||"");
    let msg="";
    if(ts.length<4||ys.length<4)msg="Enter at least four time values and four measurements.";
    else if(ts.length!==ys.length)msg="Time and measurement lists must contain the same number of values.";
    else if([...ts,...ys].some(x=>!Number.isFinite(x)))msg="Only valid numeric values are allowed.";
    else if(ts.some((x,i)=>i&&x<=ts[i-1]))msg="Time values must be strictly increasing.";
    else if(ys.some(x=>x<=0))msg="Measurements must be greater than zero.";
    if(msg){if(error){error.textContent=msg;error.hidden=false;}return;}
    const horizon=Number($("steps")?.value||5);
    const L=fitModel("L",ts,ys), G=fitModel("G",ts,ys);
    renderResults(ts,ys,L,G,horizon);
  }

  // Canvas-based pseudo-3D renderer: rotation, depth, animated trace and zoom.
  function draw3D(canvas, mode, view) {
    const s=canvasSetup(canvas);if(!s)return;const {c,w,h}=s;c.clearRect(0,0,w,h);
    const cx=w*.52,cy=h*.72, scale=Math.min(w,h)*.34*view.zoom;
    const project=(x,y,z)=>{const a=view.rotY,b=view.rotX;const xx=x*Math.cos(a)-z*Math.sin(a), zz=x*Math.sin(a)+z*Math.cos(a);const yy=y*Math.cos(b)-zz*Math.sin(b);const z2=y*Math.sin(b)+zz*Math.cos(b);const perspective=3.4/(3.4+z2*.16);return{x:cx+xx*scale*perspective,y:cy-yy*scale*perspective};};
    c.lineWidth=1;c.strokeStyle=colors.grid;
    for(let i=-4;i<=4;i++){line(c,[project(i/4,0,-1),project(i/4,0,1)],colors.grid);line(c,[project(-1,0,i/4),project(1,0,i/4)],colors.grid);}
    line(c,[project(-1,0,-1),project(1,0,-1)],"rgba(120,170,255,.55)");
    line(c,[project(-1,0,-1),project(-1,1,-1)],"rgba(120,170,255,.55)");
    const curve=(kind,z)=>{
      const pts=[];for(let i=0;i<=180;i++){const t=i/180*12;let y=kind==="L"?logistic(t,100,.5,9)/100:gompertz(t,100,.5,Math.log(10))/100;pts.push(project(-1+t/6,y*1.65-0.05,z));}return pts;
    };
    if(mode==="L"||mode==="C")for(let k=0;k<5;k++)line(c,curve("L",-.65+k*.32),`rgba(69,201,255,${.28+k*.12})`,k===2?2.8:1.3);
    if(mode==="G"||mode==="C")for(let k=0;k<5;k++)line(c,curve("G",-.65+k*.32),`rgba(173,140,255,${.28+k*.12})`,k===2?2.8:1.3);
    const time=(performance.now()%5000)/5000*12, yy=mode==="G"?gompertz(time,100,.5,Math.log(10))/100:logistic(time,100,.5,9)/100;
    const p=project(-1+time/6,yy*1.65-.05,0);c.fillStyle=mode==="G"?colors.G:colors.L;c.shadowBlur=18;c.shadowColor=c.fillStyle;c.beginPath();c.arc(p.x,p.y,5,0,7);c.fill();c.shadowBlur=0;
    c.font="11px monospace";c.fillStyle=colors.text;c.fillText("TIME →",w-70,h-12);c.fillText("GROWTH ↑",8,18);
  }
  function init3D(){
    const hero=$("heroCanvas");let heroView={rotX:.45,rotY:-.45,zoom:1};
    const views=[];
    document.querySelectorAll(".viewer").forEach(card=>{
      const canvas=card.querySelector("canvas");const mode=card.dataset.v;
      const view={rotX:.55,rotY:-.5,zoom:1,drag:false,x:0,y:0};views.push({canvas,mode,view});
      const redraw=()=>draw3D(canvas,mode,view);
      canvas.addEventListener("pointerdown",e=>{view.drag=true;view.x=e.clientX;view.y=e.clientY;canvas.setPointerCapture(e.pointerId);});
      canvas.addEventListener("pointermove",e=>{if(!view.drag)return;view.rotY+=(e.clientX-view.x)*.008;view.rotX=clamp(view.rotX+(e.clientY-view.y)*.008,-1.2,1.2);view.x=e.clientX;view.y=e.clientY;redraw();});
      canvas.addEventListener("pointerup",()=>view.drag=false);canvas.addEventListener("pointercancel",()=>view.drag=false);
      canvas.addEventListener("wheel",e=>{if(e.ctrlKey||e.shiftKey){e.preventDefault();view.zoom=clamp(view.zoom*(e.deltaY>0?.92:1.08),.55,2.5);redraw();}},{passive:false});
      card.querySelectorAll("[data-act]").forEach(btn=>btn.addEventListener("click",()=>{const a=btn.dataset.act;if(a==="in")view.zoom=clamp(view.zoom*1.15,.55,2.5);if(a==="out")view.zoom=clamp(view.zoom/1.15,.55,2.5);if(a==="reset"){view.rotX=.55;view.rotY=-.5;view.zoom=1;}if(a==="replay")view.start=performance.now();redraw();}));
      redraw();
    });
    const bg=$("bg"), heroCanvas=$("heroCanvas");
    function frame(){
      if(heroCanvas)draw3D(heroCanvas,"C",heroView);
      if(bg){const s=canvasSetup(bg);if(s){const {c,w,h}=s;c.clearRect(0,0,w,h);for(let i=0;i<65;i++){const x=(i*7919%997)/997*w,y=(i*3571%991)/991*h;c.fillStyle=`rgba(85,165,255,${.12+.12*Math.sin(performance.now()/1500+i)})`;c.beginPath();c.arc(x,y,1.1,0,7);c.fill();}}}
      views.forEach(v=>draw3D(v.canvas,v.mode,v.view));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function drawSimple(canvas, fn, maxY=110, fill=false){
    const s=canvasSetup(canvas);if(!s)return;const {c,w,h}=s;c.clearRect(0,0,w,h);const X=t=>35+t/14*(w-50),Y=y=>h-25-y/maxY*(h-45);
    for(let i=0;i<=4;i++){const y=15+i*(h-40)/4;line(c,[{x:30,y},{x:w-10,y}],colors.grid);}
    const pts=[];for(let i=0;i<=140;i++){const t=i/10;pts.push({x:X(t),y:Y(fn(t))});}
    if(fill){c.beginPath();c.moveTo(X(0),Y(0));pts.forEach(p=>c.lineTo(p.x,p.y));c.lineTo(X(14),Y(0));c.closePath();c.fillStyle="rgba(69,201,255,.12)";c.fill();}
    line(c,pts,colors.L,2.3);
  }
  function initCalculus(){
    const tEl=$("calcT");let kind="L";
    const params={K:100,r:.5,A:9};
    function update(){
      const t=Number(tEl?.value||4), fn=x=>kind==="L"?logistic(x,100,.5,9):gompertz(x,100,.5,Math.log(10));
      const n=fn(t), d=kind==="L"?.5*n*(1-n/100):.5*n*Math.log(100/n);
      const eps=.001, numeric=(fn(t+eps)-fn(t-eps))/(2*eps);
      let integral=0,steps=500,dt=t/steps;for(let i=0;i<steps;i++){const x=(i+.5)*dt;integral+=(kind==="L"?.5*fn(x)*(1-fn(x)/100):.5*fn(x)*Math.log(100/fn(x)))*dt;}
      setText("calcTv",t.toFixed(1));setText("cN1",fmt(n,3));setText("cD1",fmt(d,3));setText("cD2",fmt(numeric,3));setText("cI1",fmt(integral,3));setText("cI2",fmt(n-10,3));
      drawSimple($("calcA"),fn,110);drawSimple($("calcB"),x=>kind==="L"?.5*fn(x)*(1-fn(x)/100):.5*fn(x)*Math.log(100/fn(x)),14,true);
    }
    tEl?.addEventListener("input",update);
    $("calcKinds")?.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{kind=b.dataset.k;$("calcKinds").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));update();}));
    update();
  }

  function initLeastSquares(){
    const canvas=$("lsCanvas");if(!canvas)return;let K=100,r=.5;
    const ts=sampleT,ys=sampleY;
    const err=(k,rate)=>{const A=(k-10)/10;return sum(ts.map((t,i)=>(logistic(t,k,rate,A)-ys[i])**2));};
    function paint(){
      const s=canvasSetup(canvas);if(!s)return;const {c,w,h}=s;
      for(let y=0;y<h;y+=3)for(let x=0;x<w;x+=3){const k=60+x/w*70,rate=.15+y/h*1.0,e=Math.log1p(err(k,rate));const q=clamp(e/7,0,1);c.fillStyle=`rgba(${Math.round(30+q*80)},${Math.round(80+q*40)},${Math.round(150+q*60)},.9)`;c.fillRect(x,y,3,3);}
      const x=(K-60)/70*w,y=(r-.15)/1*h;c.strokeStyle="#fff";c.lineWidth=2;c.beginPath();c.arc(x,y,8,0,7);c.stroke();
      setText("lK",fmt(K,2));setText("lR",fmt(r,4));setText("lS",fmt(err(K,r),3));
      const eK=.01,eR=.0001;setText("lDK",fmt((err(K+eK,r)-err(K-eK,r))/(2*eK),3));setText("lDR",fmt((err(K,r+eR)-err(K,r-eR))/(2*eR),3));
    }
    const move=e=>{const rect=canvas.getBoundingClientRect();K=clamp(60+(e.clientX-rect.left)/rect.width*70,60,130);r=clamp(.15+(e.clientY-rect.top)/rect.height, .15,1.15);paint();};
    canvas.addEventListener("pointerdown",e=>{canvas.setPointerCapture(e.pointerId);move(e);});canvas.addEventListener("pointermove",e=>{if(e.buttons)move(e);});
    $("lsGo")?.addEventListener("click",()=>{for(let i=0;i<160;i++){const gK=(err(K+.01,r)-err(K-.01,r))/.02,gR=(err(K,r+.0001)-err(K,r-.0001))/.0002;K=clamp(K-gK*.00002,60,130);r=clamp(r-gR*.000001,.15,1.15);}paint();});
    $("lsReset")?.addEventListener("click",()=>{K=100;r=.5;paint();});paint();
  }

  const pythonSnippets={
    numpy:["NumPy","Fast numerical arrays and vectorised model equations.","The live calculator performs equivalent numerical operations in JavaScript.","numpy_model.py",`import numpy as np\n\ndef logistic(t, K, r, A):\n    return K / (1 + A * np.exp(-r * t))\n\nt = np.array([0, 1, 2, 4, 6, 8])\npredicted = logistic(t, 100, 0.5, 9)`],
    pandas:["Pandas","Stores observations in labelled tables and helps clean missing or inconsistent data.","The website accepts comma-separated values and validates them before fitting.","prepare_data.py",`import pandas as pd\n\ndata = pd.DataFrame({\n    "time": [0, 1, 2, 4, 6, 8],\n    "size": [10, 15.5, 23.2, 45.1, 69.1, 85.8]\n})\ndata = data.sort_values("time").dropna()`],
    scipy:["SciPy","Provides nonlinear least-squares optimisation for estimating model parameters.","The browser version uses a deterministic numerical grid search and refinement.","fit_model.py",`from scipy.optimize import curve_fit\nimport numpy as np\n\ndef logistic(t, K, r, A):\n    return K / (1 + A * np.exp(-r*t))\n\nparams, covariance = curve_fit(\n    logistic, time, size,\n    p0=[100, 0.5, 9], maxfev=20000\n)`],
    sympy:["SymPy","Symbolically differentiates the growth equations and checks calculus steps.","The derivative values shown in the calculus lab are evaluated numerically in JavaScript.","derive.py",`import sympy as sp\n\nt, K, r, A = sp.symbols("t K r A", positive=True)\nN = K / (1 + A * sp.exp(-r*t))\ngrowth_rate = sp.diff(N, t)\nprint(sp.simplify(growth_rate))`],
    matplotlib:["Matplotlib","Creates publication-quality plots for observations, fitted curves and forecasts.","The deployed website draws charts directly on HTML Canvas.","plot.py",`import matplotlib.pyplot as plt\n\nplt.scatter(time, size, label="observed")\nplt.plot(t_dense, logistic(t_dense, *params),\n         label="Logistic fit")\nplt.xlabel("Time")\nplt.ylabel("Measured size")\nplt.legend()\nplt.show()`],
    full:["Full pipeline","A typical academic workflow from raw observations to model comparison.","This hosted project runs the equivalent fitting and metrics entirely client-side.","pipeline.py",`import numpy as np\nfrom scipy.optimize import curve_fit\n\np_log, _ = curve_fit(logistic, time, size)\np_gomp, _ = curve_fit(gompertz, time, size)\n\nfor name, model, params in [\n    ("Logistic", logistic, p_log),\n    ("Gompertz", gompertz, p_gomp)\n]:\n    residual = size - model(time, *params)\n    rmse = np.sqrt(np.mean(residual**2))\n    mae = np.mean(np.abs(residual))\n    print(name, rmse, mae)`]
  };
  function initPython(){
    const tabs=$("pyTabs");if(!tabs)return;
    function show(key){const d=pythonSnippets[key]||pythonSnippets.numpy;setText("pyT",d[0]);setText("pyD",d[1]);setText("pyJ",d[2]);setText("pyF",d[3]);const code=$("pyCode");if(code)code.textContent=d[4];tabs.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.k===key));}
    tabs.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>show(b.dataset.k)));
    $("pyCopy")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("pyCode").textContent);setText("pyCopy","Copied");setTimeout(()=>setText("pyCopy","Copy"),1300);}catch(e){setText("pyCopy","Select code");}});
    show("numpy");
  }
  function initUI(){
    const navBtn=$("navBtn");navBtn?.addEventListener("click",()=>{const open=!document.body.classList.contains("menu");document.body.classList.toggle("menu",open);navBtn.setAttribute("aria-expanded",String(open));});
    document.querySelectorAll("#menu a").forEach(a=>a.addEventListener("click",()=>{document.body.classList.remove("menu");navBtn?.setAttribute("aria-expanded","false");}));
    $("steps")?.addEventListener("input",e=>{setText("stepValue",`${e.target.value} steps`);state.horizon=Number(e.target.value);});
    $("analyzeBtn")?.addEventListener("click",analyze);
    $("sampleBtn")?.addEventListener("click",()=>{$("times").value=sampleT.join(", ");$("values").value=sampleY.join(", ");analyze();});
    ["times","values"].forEach(id=>$(id)?.addEventListener("keydown",e=>{if(e.key==="Enter")analyze();}));
    ["cK","cR","cN"].forEach(id=>$(id)?.addEventListener("input",()=>{
      const K=Number($("cK").value),r=Number($("cR").value),N0=Number($("cN").value),A=(K-N0)/N0;
      setText("cKv",K);setText("cRv",r.toFixed(2));setText("cNv",N0);
      document.querySelectorAll(".viewer").forEach(card=>{const can=card.querySelector("canvas");const mode=card.dataset.v;const v=state.views.get(can)||{rotX:.55,rotY:-.5,zoom:1};state.views.set(can,v);draw3D(can,mode,v);});
    }));
    const observer=("IntersectionObserver" in window)?new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");observer.unobserve(e.target);}}),{threshold:.08}):null;
    document.querySelectorAll(".rv").forEach(el=>observer?observer.observe(el):el.classList.add("in"));
    document.querySelectorAll("[data-count]").forEach(el=>{const target=Number(el.dataset.count);let start=null;function tick(ts){if(!start)start=ts;const p=clamp((ts-start)/900,0,1);el.textContent=Math.round(target*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);});
    if(window.gsap){window.gsap.from(".hero-copy .hl",{y:22,opacity:0,duration:.8,stagger:.12,ease:"power3.out",delay:.15});}
  }
  function boot(){
    try{
      initUI();init3D();initCalculus();initLeastSquares();initPython();
      analyze();
    }catch(err){console.error("Cureconomics initialization:",err);const e=$("errorBox");if(e){e.hidden=false;e.textContent="Some interactive components could not initialize. Please refresh the page.";}}
    // Never leave the user trapped behind the loading overlay.
    const loader=$("loader");if(loader){loader.classList.add("done");setTimeout(()=>loader.remove(),900);}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  // Safety release if a CDN or optional visualization fails unexpectedly.
  window.addEventListener("load",()=>{const loader=$("loader");if(loader){loader.classList.add("done");setTimeout(()=>loader.remove(),900);}});
})();
