// Native spatial DTO contracts. Fixtures contain no provider account data.
export const spatialCases = [
 {name:"native box_touches uses the attacking half pitch",run({eventMapSVG},assert){const html=eventMapSVG({items:[{x:.25,y:.75}]},{kind:"box_touches",title:"Box touches"});assert.match(html,/viewBox="0 0 310 230"/);assert.match(html,/M82 2v72h146V2/);assert.doesNotMatch(html,/M155 2v206/);}},
 {name:"native passes retain the full pitch",run({eventMapSVG},assert){const html=eventMapSVG({items:[{x:.25,y:.75,destination:{x:.5,y:.2}}]},{kind:"passes_complete"});assert.match(html,/viewBox="0 0 310 210"/);assert.match(html,/M155 2v206/);assert.match(html,/<path d="M78.5 156.5L155 43.2"/);}},
 {name:"native shots retain the half-pitch contract",run({eventMapSVG},assert){assert.match(eventMapSVG({items:[{x:0,y:1}]},{kind:"shots"}),/viewBox="0 0 310 230"/);}},
 {name:"confirmed empty events differ from unavailable maps",run({eventMapSVG},assert){assert.match(eventMapSVG({items:[]},{kind:"box_touches"}),/No events recorded/);assert.match(eventMapSVG(null,{kind:"box_touches"}),/Map unavailable/);}},
 {name:"invalid coordinates are not plotted as real events",run({eventMapSVG},assert){const html=eventMapSVG({items:[{x:.25,y:.5},{x:NaN,y:0},{x:-1,y:1},{x:1,y:Infinity}]},{kind:"box_touches"});assert.match(html,/1 of 4 event locations available/);assert.equal((html.match(/<circle cx=/g)||[]).length,1);assert.doesNotMatch(html,/NaN|Infinity/);}},
 {name:"map titles are escaped",run({eventMapSVG},assert){const html=eventMapSVG({items:[{x:0,y:0}]},{kind:"box_touches",title:'<img src=x onerror="alert(1)">'});assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);}},
 {name:"confirmed zero heatmap remains valid without fabricated activity",run({heatmapSVG},assert){const html=heatmapSVG({grid_cols:2,grid_rows:2,grid:[0,0,0,0]});assert.match(html,/<svg/);assert.doesNotMatch(html,/fill="#ffb84d"/);}},
 {name:"malformed heatmap remains unavailable",run({heatmapSVG},assert){assert.match(heatmapSVG({grid_cols:2,grid_rows:2,grid:[1,2]}),/Map unavailable/);}}
];
export function runSpatialCases(api,assert){const completed=[];for(const test of spatialCases){test.run(api,assert);completed.push(test.name);}return completed;}
