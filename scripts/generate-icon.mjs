import {mkdirSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

// Render Quiet Screen's play mark at Windows icon sizes.
function crc32(bytes){let crc=0xffffffff;for(let byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(name,data){let type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc])}
function rounded(x,y,left,top,width,height,radius){let dx=Math.max(left+radius-x,0,x-(left+width-radius)),dy=Math.max(top+radius-y,0,y-(top+height-radius));return x>=left&&x<=left+width&&y>=top&&y<=top+height&&dx*dx+dy*dy<=radius*radius}
function stroke(x,y,left,top,width,height){return rounded(x,y,left,top,width,height,4)&&!rounded(x,y,left+6,top+6,width-12,height-12,1)}
function pixel(x,y){
 if(!rounded(x,y,8,8,240,240,52))return [0,0,0,0];
 const inside=x>=84&&x<=176&&Math.abs(y-128)<=(176-x)*.6;
 const inner=x>=92&&x<=160&&Math.abs(y-128)<=(160-x)*.6;
 return inside&&!inner?[32,26,50,255]:[179,161,244,255];
}function png(size){let rows=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){let sum=[0,0,0,0];for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){let p=pixel((x+(sx+.5)/4)*256/size,(y+(sy+.5)/4)*256/size);for(let c=0;c<4;c++)sum[c]+=p[c]}let at=y*(size*4+1)+1+x*4;for(let c=0;c<4;c++)rows[at+c]=Math.round(sum[c]/16)}let ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
let sizes=[16,24,32,48,64,128,256],images=sizes.map(png),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;for(let i=0;i<sizes.length;i++){let at=6+16*i;header[at]=header[at+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length}
mkdirSync('desktop/assets',{recursive:true});writeFileSync('desktop/assets/icon.ico',Buffer.concat([header,...images]));writeFileSync('desktop/assets/icon.png',images.at(-1));
console.log('Desktop icons generated.');
