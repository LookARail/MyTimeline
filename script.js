// --- UTC-consistent formatters ---
const fmt = new Intl.DateTimeFormat(undefined, { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month:'short', year:'numeric', timeZone:'UTC' });
const fmtMonthOnly = new Intl.DateTimeFormat(undefined, { month:'short', timeZone:'UTC' });
const fmtYearOnly = new Intl.DateTimeFormat(undefined, { year:'numeric', timeZone:'UTC' });

// --- Utility functions (UTC) ---
function pad2(n){ return String(n).padStart(2,'0'); }
function yyyy_mm_dd_utc(d){ return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`; }
function todayUTCStr(){ const now=new Date(); return yyyy_mm_dd_utc(now); }
function toDateUTC(str){ const [y,m,d] = str.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)); }
function dateUTC(y,m,d){ return new Date(Date.UTC(y, m-1, d)); }

// --- App State ---
const state = {
	types: [
		{ id:'type-planning', name:'Planning', color:'#3A86FF' },
		{ id:'type-strategic', name:'Strategic', color:'#8338EC' },
		{ id:'type-finance', name:'Finance', color:'#FF006E' }
	],
	tasks: [
		{
			id:'task-1', name:'Quarterly Planning', description:'High-level planning for Q1', typeIds:['type-planning','type-strategic'], children:[
				{ id:'task-1-1', name:'Stakeholder alignment', description:'Sessions with team leads', typeIds:['type-planning'], children:[], activities:[
					{ id:'act-101', date: yyyy_mm_dd_utc(new Date()), description:'Kickoff' },
					{ id:'act-102', date: yyyy_mm_dd_utc(new Date(Date.now()+3*86400000)), description:'Alignment review' }
				] },
				{ id:'task-1-2', name:'Budget adjustments', description:'Reallocate based on priorities', typeIds:['type-finance'], children:[], activities:[
					{ id:'act-201', date: yyyy_mm_dd_utc(new Date(Date.now()+5*86400000)), description:'Initial proposal' }
				] }
			], activities:[]
		},
		{ id:'task-2', name:'Team Hiring', description:'Pipeline & interviews', typeIds:['type-strategic'], children:[], activities:[
			{ id:'act-301', date: yyyy_mm_dd_utc(new Date(Date.now()-2*86400000)), description:'JD finalized' },
			{ id:'act-302', date: yyyy_mm_dd_utc(new Date(Date.now()+10*86400000)), description:'Panel interview' }
		] }
	],
	settings: { zoom:'week', filterTypeIds: [], firstTypeColorWins: true, scale: 1 }
};

// --- Persistence ---
const LS_KEY = 'activity-gantt-state-v4';
function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function loadState(){ const s=localStorage.getItem(LS_KEY); if(!s) return; try{ const parsed = JSON.parse(s); if(!parsed || typeof parsed !== 'object') return; // ignore invalid
		// Merge arrays only when present
		if(Array.isArray(parsed.types)) state.types = parsed.types;
		if(Array.isArray(parsed.tasks)) state.tasks = parsed.tasks;
		// Merge settings shallowly to preserve newly-introduced defaults
		if(parsed.settings && typeof parsed.settings === 'object'){
				state.settings = Object.assign({}, state.settings || {}, parsed.settings);
		}
		// keep any other top-level keys if needed without clobbering
		if(parsed.hasOwnProperty('someOther')) state.someOther = parsed.someOther;
	}catch(e){} }
loadState();

// Debounce helper to batch frequent input changes
function debounce(fn, wait){ let t=null; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this, args), wait); }; }

// debounced render to avoid synchronous re-renders on rapid input
const debouncedRenderGantt = debounce(()=>{ try{ renderGantt(); }catch(e){ console.error(e); } }, 220);

// --- Helpers ---
function getTypeById(id){ return state.types.find(t=>t.id===id); }
function getPrimaryColor(task){ const id = task.typeIds && task.typeIds[0]; const type = id ? getTypeById(id) : null; return type ? type.color : '#64748b'; }
function isLeaf(task){ return Array.isArray(task.children) && task.children.length===0; }
function findTaskWithParent(id){ let result=null; function walk(node,parent=null){ if(node.id===id){ result={node,parent}; return;} (node.children||[]).forEach(ch=>{ if(!result) walk(ch,node); }); } state.tasks.forEach(t=>walk(t,null)); return result; }

// simple uid helper used for generating ids for tasks/types/activities
function uid(prefix){ const rnd = Math.floor(Math.random()*90000)+10000; return `${prefix || 'id'}-${Date.now().toString(36)}-${rnd.toString(36)}`; }

// Visible rows builder (parent header + child leaves)
function buildVisibleRows(){ const rows=[]; const filterIds = state.settings.filterTypeIds; const passes=(node)=> !filterIds || filterIds.length===0 || (node.typeIds||[]).some(id=>filterIds.includes(id)); state.tasks.forEach(parent=>{ if(isLeaf(parent)){ if(passes(parent)) rows.push({kind:'parent', node:parent, isLeaf:true}); } else { const kids=(parent.children||[]).filter(passes).map(ch=>({kind:'child', node:ch, parent:parent})); if(kids.length>0){ rows.push({kind:'parent', node:parent, isLeaf:false}); rows.push(...kids); } } }); return rows; }

// Activities + timeline
function getAllActivities(tasks){ const acts=[]; function walk(n){ (n.activities||[]).forEach(a=>acts.push(a)); (n.children||[]).forEach(walk); } tasks.forEach(walk); return acts; }
function timelineRange(){ const acts=getAllActivities(state.tasks); const now=new Date(); let minD = dateUTC(now.getUTCFullYear(), now.getUTCMonth()+1, now.getUTCDate()); let maxD = new Date(minD.getTime()+90*86400000); if(acts.length){ const dates = acts.map(a=>toDateUTC(a.date)); minD = new Date(Math.min(...dates)); maxD = new Date(Math.max(...dates)); } minD = new Date(minD.getTime() - 15*86400000); maxD = new Date(maxD.getTime() + 30*86400000); const minWindowDays=180; let curDays=Math.floor((maxD - minD)/86400000); if(curDays < minWindowDays){ const center=new Date((minD.getTime()+maxD.getTime())/2); minD = new Date(center.getTime() - (minWindowDays/2)*86400000); maxD = new Date(center.getTime() + (minWindowDays/2)*86400000); curDays = minWindowDays; }
	// clamp excessively large ranges to avoid creating thousands of DOM elements
	const maxWindowDays = 365 * 3; // 3 years max span
	if(curDays > maxWindowDays){ const center = new Date((minD.getTime()+maxD.getTime())/2); minD = new Date(center.getTime() - (maxWindowDays/2)*86400000); maxD = new Date(center.getTime() + (maxWindowDays/2)*86400000); }
	return { minD, maxD }; }


function pxPerDay(){ const base = (function(){ switch(state.settings.zoom){ case 'day': return 40; case 'week': return 14; case 'month': return 5; case 'quarter': return 2.5; default: return 14; } })(); return base * (state.settings.scale || 1); }

// Safer tick generator with sampling for very large ranges
function getTickDates(minDUTC, maxDUTC){ const ticks=[]; const rangeDays = Math.max(1, Math.floor((maxDUTC - minDUTC)/86400000));
	if(state.settings.zoom==='week'){
		let tickDate = startOfISOWeekUTC(minDUTC);
		while(tickDate <= maxDUTC){ ticks.push(new Date(tickDate)); tickDate = new Date(tickDate.getTime()+7*86400000); }
	} else if(state.settings.zoom==='month'){
		let tickDate = startOfMonthUTC(minDUTC);
		while(tickDate <= maxDUTC){ ticks.push(new Date(tickDate)); const y=tickDate.getUTCFullYear(), m=tickDate.getUTCMonth(); tickDate = new Date(Date.UTC(y, m+1, 1)); }
	} else if(state.settings.zoom==='quarter'){
		let tickDate = startOfQuarterUTC(minDUTC);
		while(tickDate <= maxDUTC){ ticks.push(new Date(tickDate)); const y=tickDate.getUTCFullYear(), m=tickDate.getUTCMonth(); tickDate = new Date(Date.UTC(y, m+3, 1)); }
	} else {
		// day zoom: avoid creating an element per day for extremely large ranges
		const maxTicks = 400; // target max tick elements to keep UI responsive
		const step = Math.max(1, Math.ceil(rangeDays / maxTicks));
		let tickDate = new Date(minDUTC.getTime());
		while(tickDate <= maxDUTC){ ticks.push(new Date(tickDate)); tickDate = new Date(tickDate.getTime() + step * 86400000); }
	}
	return ticks;
}
function xForDate(dateStr, minDUTC){ const dUTC = toDateUTC(dateStr); const days = Math.round((dUTC.getTime() - minDUTC.getTime())/86400000); return days * pxPerDay(); }

// ISO week anchor (Monday start)
function startOfISOWeekUTC(dateUTC){ const dow=dateUTC.getUTCDay(); const daysFromMonday=(dow+6)%7; return new Date(dateUTC.getTime() - daysFromMonday*86400000); }
function startOfMonthUTC(dateUTC){ return dateUTC ? new Date(Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), 1)) : null; }
function startOfQuarterUTC(dateUTC){ const m = dateUTC.getUTCMonth(); const qStart = Math.floor(m/3)*3; return new Date(Date.UTC(dateUTC.getUTCFullYear(), qStart, 1)); }

// Week number (ISO-ish) using UTC
function weekNumber(date){ const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const dayNum=(tmp.getUTCDay()+6)%7; tmp.setUTCDate(tmp.getUTCDate()-dayNum+3); const firstThursday=new Date(Date.UTC(tmp.getUTCFullYear(),0,4)); const weekNum=1+Math.round(((tmp-firstThursday)/86400000 - 3)/7); return weekNum; }

// --- DOM refs ---
const typeListEl=document.getElementById('type-list');
const filterListEl=document.getElementById('filter-list');
const legendEl=document.getElementById('legend');
const rowsEl=document.getElementById('rows');
const timelineScroll=document.getElementById('timeline-scroll');
const svgWrap=document.getElementById('svg-wrap');
const axisTimeline=document.getElementById('axis-timeline');
const zoomSelect=document.getElementById('zoom-select');
const tooltipEl=document.getElementById('tooltip');
let axisContentEl=null;
let __lastZoom = state.settings.zoom;
let __lastScale = state.settings.scale || 1;
let __firstRender = true;

function renderTypesPanel(){ typeListEl.innerHTML=''; state.types.forEach(t=>{ const row=document.createElement('div'); row.className='type-item'; const sw=document.createElement('div'); sw.className='type-swatch'; sw.style.background=t.color; const name=document.createElement('div'); name.textContent=t.name; const del=document.createElement('button'); del.className='btn'; del.textContent='Delete'; del.onclick=()=>{ if(confirm('Delete type "'+t.name+'"?')){ state.types=state.types.filter(x=>x.id!==t.id); function strip(n){ if(n.typeIds) n.typeIds=n.typeIds.filter(x=>x!==t.id); (n.children||[]).forEach(strip);} state.tasks.forEach(strip); saveState(); renderAll(); } }; row.append(sw,name,del); typeListEl.appendChild(row); }); }

	function renderTypesPanel(){
		typeListEl.innerHTML='';
		state.types.forEach(t=>{
			const row=document.createElement('div'); row.className='type-item';
			const sw=document.createElement('div'); sw.className='type-swatch'; sw.style.background=t.color;
			const name=document.createElement('div'); name.textContent=t.name;

			const editBtn = document.createElement('button'); editBtn.className='btn'; editBtn.textContent='Edit';
			editBtn.onclick = ()=>{
				// replace display with editors
				row.innerHTML='';
				const nameInput = document.createElement('input'); nameInput.className='input'; nameInput.value = t.name;
				const colorInput = document.createElement('input'); colorInput.type='color'; colorInput.value = t.color;
				const saveBtn = document.createElement('button'); saveBtn.className='btn primary'; saveBtn.textContent='Save';
				const cancelBtn = document.createElement('button'); cancelBtn.className='btn'; cancelBtn.textContent='Cancel';
				saveBtn.onclick = ()=>{
					const newName = nameInput.value.trim() || t.name;
					const newColor = colorInput.value;
					t.name = newName; t.color = newColor;
					saveState(); renderAll();
				};
				cancelBtn.onclick = ()=>{ renderTypesPanel(); };
				row.append(nameInput, colorInput, saveBtn, cancelBtn);
			};

			const del=document.createElement('button'); del.className='btn'; del.textContent='Delete'; del.onclick=()=>{ if(confirm('Delete type "'+t.name+'"?')){ state.types=state.types.filter(x=>x.id!==t.id); function strip(n){ if(n.typeIds) n.typeIds=n.typeIds.filter(x=>x!==t.id); (n.children||[]).forEach(strip);} state.tasks.forEach(strip); saveState(); renderAll(); } };

			row.append(sw,name,editBtn,del);
			typeListEl.appendChild(row);
		});
	}
function renderFilters(){ filterListEl.innerHTML=''; state.types.forEach(t=>{ const row=document.createElement('div'); row.className='type-item'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=state.settings.filterTypeIds.includes(t.id); cb.onchange=()=>{ const set=new Set(state.settings.filterTypeIds); if(cb.checked) set.add(t.id); else set.delete(t.id); state.settings.filterTypeIds=Array.from(set); saveState(); renderGantt(); renderLegend(); }; const sw=document.createElement('div'); sw.className='type-swatch'; sw.style.background=t.color; const name=document.createElement('div'); name.textContent=t.name; row.append(cb,sw,name); filterListEl.appendChild(row); }); }
document.getElementById('btn-filter-clear').onclick=()=>{ state.settings.filterTypeIds=[]; saveState(); renderGantt(); renderFilters(); renderLegend(); };
document.getElementById('btn-filter-all').onclick=()=>{ state.settings.filterTypeIds=state.types.map(t=>t.id); saveState(); renderGantt(); renderFilters(); renderLegend(); };

function renderAxis(minDUTC, maxDUTC, width){ axisTimeline.innerHTML=''; const container=document.createElement('div'); container.style.position='relative'; container.style.width=width+'px'; container.style.height='100%'; const pxD=pxPerDay();
	
	// ===== WEEKEND COLUMN BACKGROUNDS =====
	// Add weekend column backgrounds in Day mode (must be added first so they appear behind labels)
	if (state.settings.zoom === 'day') {
		const days = Math.round((maxDUTC.getTime() - minDUTC.getTime()) / 86400000);
		for (let i = 0; i <= days; i++) {
			const date = new Date(minDUTC.getTime() + i * 86400000);
			const dow = date.getUTCDay();
			if (dow === 0 || dow === 6) { // Sunday or Saturday
				const x = Math.round((date.getTime() - minDUTC.getTime()) / 86400000) * pxD;
				const bg = document.createElement('div');
				bg.className = 'weekend-header-bg';
				bg.style.position = 'absolute';
				bg.style.left = x + 'px';
				bg.style.top = '0';
				bg.style.width = pxD + 'px';
				bg.style.height = '100%';
				bg.style.zIndex = '0';
				container.appendChild(bg);
			}
		}
	}
	
	function addLabelAt(dateUTC, text){ const x = Math.round((dateUTC.getTime() - minDUTC.getTime())/86400000) * pxD; const lbl=document.createElement('div'); lbl.style.position='absolute'; lbl.style.left=x+'px'; lbl.style.top='50%'; lbl.style.transform='translateY(-50%)'; lbl.style.color='var(--muted)'; lbl.style.fontSize = '13px'; lbl.style.fontWeight = '600'; lbl.style.paddingLeft = '6px'; lbl.style.zIndex = '1'; lbl.innerHTML = text; container.appendChild(lbl); // also draw a vertical tick line aligned with label
		const tick=document.createElement('div'); tick.style.position='absolute'; tick.style.left=x+'px'; tick.style.top='0'; tick.style.height='100%'; tick.style.borderLeft='1px solid var(--grid-tick)'; tick.style.zIndex = '1'; container.appendChild(tick); }

	// use sampled ticks from getTickDates (safer for large ranges)
	const ticks = getTickDates(minDUTC, maxDUTC);
	for(const td of ticks){
		if(state.settings.zoom==='week'){
			addLabelAt(td, 'W'+weekNumber(td)+' '+td.getUTCFullYear());
		} else if(state.settings.zoom==='month'){
			addLabelAt(td, fmtMonth.format(td));
		} else if(state.settings.zoom==='quarter'){
			const q = Math.floor(td.getUTCMonth()/3)+1; addLabelAt(td, `Q${q} ${td.getUTCFullYear()}`);
		} else { // day (sampled)
			let html = `<div style="font-weight:600">${td.getUTCDate()}</div>`;
			if(td.getUTCDate()===1){ html += `<div style="font-size:11px;color:var(--muted)">${fmtMonthOnly.format(td)}</div>`; }
			if(td.getUTCDate()===1 && td.getUTCMonth()===0){ html += `<div style="font-size:11px;color:var(--muted)">${fmtYearOnly.format(td)}</div>`; }
			addLabelAt(td, html);
		}
	}
	axisTimeline.appendChild(container); axisContentEl=container;
}

function renderGantt(){ rowsEl.innerHTML=''; svgWrap.innerHTML=''; const {minD, maxD} = timelineRange(); const minDUTC=minD, maxDUTC=maxD; const pxD=pxPerDay(); const rangeDays=Math.floor((maxDUTC - minDUTC)/86400000); const width=(rangeDays+1)*pxD; const visibleRows=buildVisibleRows();
	// rows
	visibleRows.forEach(item=>{ const t=item.node; const row=document.createElement('div'); row.className='row '+(item.kind==='parent'?'parent':'child'); row.dataset.kind=item.kind; row.dataset.id=t.id;

		// make rows draggable (parents and children). Drag data includes id and parent id when applicable.
		row.draggable = true;
		row.ondragstart = e => {
			row.classList.add('dragging');
			const payload = { id: t.id, kind: item.kind, parentId: item.parent ? item.parent.id : null };
			try{ e.dataTransfer.setData('application/json', JSON.stringify(payload)); }catch(err){ e.dataTransfer.setData('text/plain', JSON.stringify(payload)); }
		};
		row.ondragend = () => row.classList.remove('dragging');
		row.ondragover = e => e.preventDefault();
		row.ondrop = e => {
			e.preventDefault();
			let raw = e.dataTransfer.getData('application/json');
			if(!raw) raw = e.dataTransfer.getData('text/plain');
			if(!raw) return;
			let payload = null;
			try{ payload = JSON.parse(raw); }catch(err){ return; }
			// Re-order logic:
			// - dropping on a top-level parent header with a top-level source -> reorder top-level tasks
			// - dropping on a child row when source has same parent -> reorder within that parent's children
			if(item.kind==='parent' && payload.parentId===null){
				const fromTopIndex = state.tasks.findIndex(x=>x.id===payload.id);
				const toTopIndex = state.tasks.findIndex(x=>x.id===t.id);
				if(fromTopIndex<0||toTopIndex<0) return;
				state.tasks.splice(toTopIndex,0,state.tasks.splice(fromTopIndex,1)[0]);
				saveState(); renderAll();
			} else if(item.kind==='child' && payload.parentId && item.parent && payload.parentId===item.parent.id){
				const parentNode = item.parent;
				const fromIndex = parentNode.children.findIndex(x=>x.id===payload.id);
				const toIndex = parentNode.children.findIndex(x=>x.id===t.id);
				if(fromIndex<0||toIndex<0) return;
				parentNode.children.splice(toIndex,0,parentNode.children.splice(fromIndex,1)[0]);
				saveState(); renderAll();
			}
		};
		const dot=document.createElement('div'); dot.className='dot'; dot.textContent=item.kind==='parent'?'■':'•';
		const title=document.createElement('div'); title.className='title'; title.textContent=t.name; title.ondblclick=()=>openDrawer(t.id);
		// compact color indicators for each assigned type
		const typeRects = document.createElement('div'); typeRects.className = 'type-rects';
		(t.typeIds||[]).forEach(id=>{ const type = getTypeById(id); const r=document.createElement('div'); r.className='type-rect'; r.style.background = type ? type.color : getPrimaryColor(t); typeRects.appendChild(r); });
		row.append(dot, typeRects, title);
		rowsEl.appendChild(row);
	});
	// svg
	const height = visibleRows.length * parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-height'));
	const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width', width); svg.setAttribute('height', height);
	
	// Add weekend column backgrounds in Day mode
	if (state.settings.zoom === 'day') {
		const days = Math.round((maxDUTC.getTime() - minDUTC.getTime()) / 86400000);
		for (let i = 0; i <= days; i++) {
			const date = new Date(minDUTC.getTime() + i * 86400000);
			const dow = date.getUTCDay();
			if (dow === 0 || dow === 6) { // Sunday or Saturday
				const x = Math.round((date.getTime() - minDUTC.getTime()) / 86400000) * pxD;
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', x);
				rect.setAttribute('y', 0);
				rect.setAttribute('width', pxD);
				rect.setAttribute('height', height);
				rect.setAttribute('class', 'weekend-column');
				svg.appendChild(rect);
			}
		}
	}
	
	// vertical grid/tick lines based on zoom
	const ticks = getTickDates(minDUTC, maxDUTC);
	for(const td of ticks){ const x = Math.round((td.getTime() - minDUTC.getTime())/86400000) * pxD; const vline=document.createElementNS('http://www.w3.org/2000/svg','line'); vline.setAttribute('x1',x); vline.setAttribute('x2',x); vline.setAttribute('y1',0); vline.setAttribute('y2',height); vline.setAttribute('class','grid-tick'); svg.appendChild(vline); }
	// horizontal row lines
	visibleRows.forEach((item,i)=>{ const y = i * parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-height')) + parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-height'))/2; const line=document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1',0); line.setAttribute('x2',width); line.setAttribute('y1',y); line.setAttribute('y2',y); line.setAttribute('class','grid-line'); svg.appendChild(line); });
	// today line (UTC)
	const todayUTC = toDateUTC(todayUTCStr()); const todayX = Math.round((todayUTC.getTime() - minDUTC.getTime())/86400000) * pxD; const tline=document.createElementNS('http://www.w3.org/2000/svg','line'); tline.setAttribute('x1',todayX); tline.setAttribute('x2',todayX); tline.setAttribute('y1',0); tline.setAttribute('y2',height); tline.setAttribute('class','today-line'); svg.appendChild(tline);
	// activities
	visibleRows.forEach((item,i)=>{ const rowY = i * parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-height')) + parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-height'))/2; const n=item.node; const acts=(item.kind==='parent' && !item.isLeaf)?[]:(n.activities||[]); acts.forEach(a=>{ const cx=xForDate(a.date,minDUTC); const circle=document.createElementNS('http://www.w3.org/2000/svg','circle'); circle.setAttribute('cx',cx); circle.setAttribute('cy',rowY); circle.setAttribute('r',6); circle.setAttribute('fill',getPrimaryColor(n)); circle.setAttribute('class','activity'); circle.addEventListener('mouseenter',(e)=>showTooltip(e,n,a)); circle.addEventListener('mouseleave',hideTooltip); circle.addEventListener('dblclick',()=>openDrawer(n.id)); svg.appendChild(circle); }); });
	svgWrap.appendChild(svg);
	svgWrap.style.minWidth = width + 'px';
	 renderAxis(minDUTC, maxDUTC, width);

	// center today when zoom or scale changed (or on first render)
	if(axisContentEl){
		const todayUTC = toDateUTC(todayUTCStr());
		const todayX = Math.floor((todayUTC.getTime() - minDUTC.getTime())/86400000) * pxD;
		if(__firstRender || state.settings.zoom !== __lastZoom || (state.settings.scale||1) !== __lastScale){
			const desired = Math.max(0, Math.floor(todayX - (timelineScroll.clientWidth||800)/2));
			timelineScroll.scrollLeft = desired;
			axisContentEl.style.transform = `translateX(${-timelineScroll.scrollLeft}px)`;
			__lastZoom = state.settings.zoom;
			__lastScale = state.settings.scale || 1;
			__firstRender = false;
		}
	}
}

function showTooltip(e, task, act){ tooltipEl.style.display='block'; const dUTC = toDateUTC(act.date); tooltipEl.innerHTML = `<div style="font-weight:600">${task.name}</div><div style="color:var(--muted)">${fmt.format(dUTC)}</div><div>${act.description||''}</div>`; const pad=12; tooltipEl.style.left=(e.clientX+pad)+'px'; tooltipEl.style.top=(e.clientY+pad)+'px'; }
function hideTooltip(){ tooltipEl.style.display='none'; }

// Scroll sync + drag-to-pan
rowsEl.addEventListener('scroll', ()=>{ if(timelineScroll.scrollTop!==rowsEl.scrollTop) timelineScroll.scrollTop=rowsEl.scrollTop; });
timelineScroll.addEventListener('scroll', ()=>{ if(rowsEl.scrollTop!==timelineScroll.scrollTop) rowsEl.scrollTop=timelineScroll.scrollTop; if(axisContentEl){ axisContentEl.style.transform = `translateX(${-timelineScroll.scrollLeft}px)`; } });
// mouse wheel horizontal zoom (Shift+wheel) — adjusts horizontal scale
timelineScroll.addEventListener('wheel', (e)=>{
	if(e.shiftKey){
		e.preventDefault();
		const delta = e.deltaY;
		const factor = Math.exp(-delta * 0.0015);
		state.settings.scale = Math.max(0.25, Math.min(8, (state.settings.scale || 1) * factor));
		saveState();
		renderGantt();
	}
});
let isDragging=false, dragStartX=0, dragStartY=0, startScrollLeft=0, startScrollTop=0;
timelineScroll.addEventListener('mousedown',(e)=>{ if(e.button!==0 || e.shiftKey) return; isDragging=true; dragStartX=e.clientX; dragStartY=e.clientY; startScrollLeft=timelineScroll.scrollLeft; startScrollTop=timelineScroll.scrollTop; timelineScroll.style.cursor='grabbing'; e.preventDefault(); });
window.addEventListener('mousemove',(e)=>{ if(!isDragging) return; const dx=e.clientX-dragStartX; const dy=e.clientY-dragStartY; timelineScroll.scrollLeft=startScrollLeft-dx; timelineScroll.scrollTop=startScrollTop-dy; });
window.addEventListener('mouseup',()=>{ if(!isDragging) return; isDragging=false; timelineScroll.style.cursor='auto'; });

// Drawer + editors
const drawer=document.getElementById('drawer'); const overlay=document.getElementById('overlay'); const modalTransfer=document.getElementById('modal-transfer'); let drawerTaskId=null;
function openDrawer(taskId){ const found=findTaskWithParent(taskId); if(!found) return; const t=found.node; const parent=found.parent; drawerTaskId=taskId; document.getElementById('drawer-title').textContent=t.name; const leaf=isLeaf(t); document.getElementById('drawer-sub').textContent = (!leaf && !parent ? 'Parent task • Header row (no activities)' : leaf ? 'Leaf row • Activities allowed' : 'Sub-task • Activities allowed'); document.getElementById('field-name').value=t.name; document.getElementById('field-desc').value=t.description||''; renderTypeControls(t); renderSubtaskList(t, parent); renderActivityList(t); drawer.classList.add('open'); overlay.classList.add('show'); }
function closeDrawer(){ drawer.classList.remove('open'); overlay.classList.remove('show'); drawerTaskId=null; }
document.getElementById('drawer-close').onclick=closeDrawer;

function renderTypeControls(task){ const wrap=document.getElementById('field-types'); wrap.innerHTML=''; (task.typeIds||[]).forEach((id,idx)=>{ const type=getTypeById(id); if(!type) return; const chip=document.createElement('div'); chip.className='chip'; const sw=document.createElement('span'); sw.className='type-swatch'; sw.style.background=type.color; const nm=document.createElement('span'); nm.textContent=type.name; const up=document.createElement('button'); up.className='btn'; up.textContent='↑'; up.onclick=()=>{ if(idx>0){ const arr=task.typeIds; [arr[idx-1],arr[idx]]=[arr[idx],arr[idx-1]]; saveState(); renderTypeControls(task); renderGantt(); } }; const rm=document.createElement('button'); rm.className='btn'; rm.textContent='Remove'; rm.onclick=()=>{ task.typeIds=task.typeIds.filter(x=>x!==id); saveState(); renderTypeControls(task); renderGantt(); }; chip.append(sw,nm,up,rm); wrap.appendChild(chip); }); const sel=document.getElementById('type-add-select'); sel.innerHTML=''; state.types.forEach(t=>{ const opt=document.createElement('option'); opt.value=t.id; opt.textContent=t.name; sel.appendChild(opt); }); document.getElementById('btn-type-add').onclick=()=>{ const val=sel.value; if(!val) return; if(!task.typeIds.includes(val)){ task.typeIds.push(val); saveState(); renderTypeControls(task); renderGantt(); } };
}

function renderSubtaskList(task,parentOfTask){ const field=document.getElementById('subtasks-field'); const list=document.getElementById('subtask-list'); list.innerHTML=''; const isTopLevelParent=!parentOfTask; field.style.display=isTopLevelParent?'block':'none'; if(!isTopLevelParent) return; (task.children||[]).forEach(ch=>{ const row=document.createElement('div'); row.className='row child'; const title=document.createElement('div'); title.className='title'; title.textContent=ch.name; title.ondblclick=()=>openDrawer(ch.id); const btnDel=document.createElement('button'); btnDel.className='btn'; btnDel.textContent='Delete'; btnDel.onclick=()=>{ task.children=task.children.filter(x=>x.id!==ch.id); saveState(); renderSubtaskList(task,parentOfTask); renderGantt(); }; row.append(title,btnDel); list.appendChild(row); }); document.getElementById('btn-add-subtask').onclick=()=>{ const newSub={ id:uid('task'), name:'New Sub-task', description:'', typeIds:[...task.typeIds], children:[], activities:[] }; const hadActs=(task.activities||[]).length>0; task.children=task.children||[]; task.children.push(newSub); if(hadActs){ showTransferModal(task,newSub); } else { task.activities=[]; saveState(); renderSubtaskList(task,parentOfTask); renderGantt(); } };
}

function showTransferModal(parent,newChild){ modalTransfer.classList.add('show'); overlay.classList.add('show'); document.getElementById('transfer-cancel').onclick=()=>{ parent.children=parent.children.filter(x=>x.id!==newChild.id); modalTransfer.classList.remove('show'); renderSubtaskList(parent,null); renderGantt(); }; document.getElementById('transfer-clear').onclick=()=>{ parent.activities=[]; saveState(); modalTransfer.classList.remove('show'); renderSubtaskList(parent,null); renderGantt(); }; document.getElementById('transfer-move').onclick=()=>{ newChild.activities=[...(parent.activities||[])]; parent.activities=[]; saveState(); modalTransfer.classList.remove('show'); renderSubtaskList(parent,null); renderGantt(); };
}

function renderActivityList(task){
	const note=document.getElementById('activities-note');
	const list=document.getElementById('activity-list');
	list.innerHTML='';
	if(!isLeaf(task)) note.textContent='This is a parent task with sub-tasks. Activities are not allowed here.'; else note.textContent='';
	(task.activities||[]).forEach(a=>{
		const row=document.createElement('div'); row.className='activity-item';
		const desc=document.createElement('input'); desc.value=a.description||''; desc.oninput=(e)=>{ a.description=e.target.value; saveState(); };
		const date=document.createElement('input'); date.type='date'; date.value=a.date;
		date.onchange=(e)=>{ a.date=e.target.value; saveState(); debouncedRenderGantt(); };
		const del=document.createElement('button'); del.className='btn'; del.textContent='Delete';
		del.onclick=()=>{ task.activities=task.activities.filter(x=>x.id!==a.id); saveState(); renderActivityList(task); debouncedRenderGantt(); };
		row.append(desc,date,del); list.appendChild(row);
	});
	document.getElementById('btn-add-activity').onclick=()=>{
		if(!isLeaf(task)){ alert('Activities can only exist on leaf tasks or sub-tasks.'); return; }
		task.activities=task.activities||[]; task.activities.push({ id:uid('act'), date:todayUTCStr(), description:'' }); saveState(); renderActivityList(task); debouncedRenderGantt();
	};
}

document.getElementById('btn-save-task').onclick=()=>{ const found=findTaskWithParent(drawerTaskId); if(!found) return; const t=found.node; t.name=document.getElementById('field-name').value.trim()||'Untitled'; t.description=document.getElementById('field-desc').value.trim(); saveState(); renderAll(); closeDrawer(); };
document.getElementById('btn-delete-task').onclick=()=>{ const found=findTaskWithParent(drawerTaskId); if(!found) return; const t=found.node; const parent=found.parent; if(parent) parent.children=parent.children.filter(x=>x.id!==t.id); else state.tasks=state.tasks.filter(x=>x.id!==t.id); saveState(); closeDrawer(); renderAll(); };

// Clicking on the overlay closes the drawer if it's open (click outside behavior)
overlay.addEventListener('click', (e)=>{ if(drawer.classList.contains('open')){ closeDrawer(); } });

document.getElementById('btn-export').onclick=async ()=>{
	const dataStr = JSON.stringify(state, null, 2);
	const blob = new Blob([dataStr], { type: 'application/json' });

	// Use File System Access API when available to show native Save dialog
	if(window.showSaveFilePicker){
		try{
			const opts = {
				suggestedName: 'activity-manager-v4.json',
				types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
			};
			const handle = await window.showSaveFilePicker(opts);
			const writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
		}catch(err){
			if(err && err.name === 'AbortError'){
				// user cancelled the Save dialog — do not save or fallback
				return;
			}
			// other errors: log and fall back to download approach
			console.error(err);
			const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'activity-manager-v4.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500);
		}
	} else {
		// fallback for browsers without showSaveFilePicker
		const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'activity-manager-v4.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500);
	}
};
// Toggleable Task Types canvas
const typesCanvas = document.getElementById('types-canvas');
const btnToggleTypes = document.getElementById('btn-toggle-types');
const btnCloseTypes = document.getElementById('btn-close-types');
if(btnToggleTypes){ btnToggleTypes.onclick = ()=>{ typesCanvas.classList.toggle('open'); renderTypesPanel(); }; }
if(btnCloseTypes){ btnCloseTypes.onclick = ()=>{ typesCanvas.classList.remove('open'); } }
// Theme toggle (Day / Night)
const btnToggleTheme = document.getElementById('btn-toggle-theme');
function applyTheme(){
	const t = state.settings.theme || 'night';
	if(t === 'day') document.body.setAttribute('data-theme','day');
	else document.body.removeAttribute('data-theme');
	if(btnToggleTheme) btnToggleTheme.textContent = t === 'day' ? 'Night' : 'Day';
}
if(!state.settings.theme) state.settings.theme = 'night';
if(btnToggleTheme){ btnToggleTheme.onclick = ()=>{ state.settings.theme = (state.settings.theme === 'day') ? 'night' : 'day'; saveState(); applyTheme(); }; }
applyTheme();
document.getElementById('import-file').onchange=(e)=>{ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=(ev)=>{ try{ const obj=JSON.parse(ev.target.result); if(!obj || typeof obj !== 'object' || !Array.isArray(obj.tasks) || !Array.isArray(obj.types)){ alert('Invalid file: expected { tasks:[], types:[] }'); return; }
			// merge safely: replace arrays only when present, shallow-merge settings to preserve defaults
			state.tasks = obj.tasks;
			state.types = obj.types;
			if(obj.settings && typeof obj.settings === 'object') state.settings = Object.assign({}, state.settings || {}, obj.settings);
			if(obj.hasOwnProperty('other')) state.other = obj.other;
			saveState(); renderAll();
		} catch(err){ alert('Failed to parse JSON: '+err.message); } }; reader.readAsText(file); };

document.getElementById('btn-add-type').onclick=()=>{ const name=document.getElementById('new-type-name').value.trim(); const color=document.getElementById('new-type-color').value; if(!name){ alert('Type name required'); return;} const id=uid('type'); state.types.push({id,name,color}); saveState(); renderAll(); document.getElementById('new-type-name').value=''; };

// Keep a reference to the new-type color input (styling is inline in HTML)
const newTypeColorInput = document.getElementById('new-type-color');

zoomSelect.onchange=()=>{ state.settings.zoom=zoomSelect.value; state.settings.scale=1; saveState(); renderGantt(); };
document.getElementById('btn-new-task').onclick=()=>{ const task={ id:uid('task'), name:'New Task', description:'', typeIds:[], children:[], activities:[] }; state.tasks.push(task); saveState(); renderAll(); openDrawer(task.id); };

function renderAll(){ renderTypesPanel(); renderFilters(); renderGantt(); }
renderAll();

// initialize saved gutter width (if any) so sidebar width persists
if(state.settings.gutterWidth){
	document.documentElement.style.setProperty('--gutter-width', state.settings.gutterWidth + 'px');
}

// Gutter resizer (drag to resize sidebar)
const gutterResizer = document.getElementById('gutter-resizer');
if(gutterResizer){
	let isResizing = false;
	const layoutEl = document.querySelector('.layout');
	gutterResizer.addEventListener('mousedown', (e)=>{
		isResizing = true;
		document.body.style.userSelect = 'none';
		e.preventDefault();
	});
	window.addEventListener('mousemove', (e)=>{
		if(!isResizing) return;
		const rect = layoutEl.getBoundingClientRect();
		let newWidth = Math.max(160, Math.min(window.innerWidth - 200, e.clientX - rect.left));
		document.documentElement.style.setProperty('--gutter-width', newWidth + 'px');
	});
	window.addEventListener('mouseup', ()=>{
		if(!isResizing) return;
		isResizing = false;
		document.body.style.userSelect = 'auto';
		const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gutter-width')) || 360;
		state.settings.gutterWidth = cur;
		saveState();
		// re-render in case layout-dependent calculations need update
		renderGantt();
	});
}
