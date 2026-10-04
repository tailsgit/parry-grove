// Runtime-only storage: never serialize pools or broad-phase data into room snapshots.
export class ObjectPool {
  constructor(factory, reserve=0) {this.factory=factory;this.free=[];this.created=0;this.grow(reserve);}
  grow(count) {for(let i=0;i<count;i++){this.free.push(this.factory());this.created++;}}
  acquire() {if(!this.free.length)this.grow(Math.max(16,this.created));return this.free.pop();}
  release(value) {this.free.push(value);}
}
export function compact(array, keep, pool) {
  let write=0;
  for(let read=0;read<array.length;read++){const value=array[read];if(keep(value))array[write++]=value;else pool?.release(value);}
  array.length=write;return array;
}
// Dense bounded spatial hash. Reuse buckets and query storage; preserve source order.
export class SpatialGrid {
  constructor(cellSize=64) {this.cellSize=cellSize;this.buckets=[];this.result=[];this.columns=0;this.rows=0;}
  reset(width,height) {
    this.columns=Math.ceil(width/this.cellSize)+2;this.rows=Math.ceil(height/this.cellSize)+2;
    const count=this.columns*this.rows;
    while(this.buckets.length<count)this.buckets.push([]);
    for(const bucket of this.buckets)bucket.length=0;
  }
  insert(index,x,y) {const cx=Math.max(0,Math.min(this.columns-1,Math.floor(x/this.cellSize)+1)),cy=Math.max(0,Math.min(this.rows-1,Math.floor(y/this.cellSize)+1));this.buckets[cy*this.columns+cx].push(index);}
  query(minX,minY,maxX,maxY) {
    const out=this.result;out.length=0;
    const x0=Math.max(0,Math.min(this.columns-1,Math.floor(minX/this.cellSize)+1)),x1=Math.max(0,Math.min(this.columns-1,Math.floor(maxX/this.cellSize)+1));
    const y0=Math.max(0,Math.min(this.rows-1,Math.floor(minY/this.cellSize)+1)),y1=Math.max(0,Math.min(this.rows-1,Math.floor(maxY/this.cellSize)+1));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const index of this.buckets[y*this.columns+x])out.push(index);
    out.sort(indexOrder);return out;
  }
}
const indexOrder=(a,b)=>a-b;

// Cache geometry and color changes, retaining Canvas's exact fillRect order.
// Replaying native primitives avoids bitmap resampling and Path2D AA differences.
export class RectangleBatch {
  constructor(capacity=2048){this.coordinates=new Float64Array(capacity*4);this.materials=new Uint16Array(capacity);this.colors=[];this.count=0;this.color=0;}
  set fillStyle(value){let index=this.colors.indexOf(value);if(index<0){index=this.colors.length;this.colors.push(value);}this.color=index;}
  fillRect(x,y,w,h){
    if(this.count===this.materials.length){const coordinates=new Float64Array(this.coordinates.length*2),materials=new Uint16Array(this.materials.length*2);coordinates.set(this.coordinates);materials.set(this.materials);this.coordinates=coordinates;this.materials=materials;}
    const offset=this.count*4;this.coordinates[offset]=x;this.coordinates[offset+1]=y;this.coordinates[offset+2]=w;this.coordinates[offset+3]=h;this.materials[this.count++]=this.color;
  }
  replay(context){
    let previous=-1;const coordinates=this.coordinates,materials=this.materials;
    for(let index=0;index<this.count;index++){const color=materials[index];if(color!==previous){context.fillStyle=this.colors[color];previous=color;}const offset=index*4;context.fillRect(coordinates[offset],coordinates[offset+1],coordinates[offset+2],coordinates[offset+3]);}
  }
}
