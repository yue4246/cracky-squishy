import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp, influence, type Hit, type MaterialEvent, type Point, SquishyStateMachine } from '../core/SquishyStateMachine';
import type { Character } from './ClayRenderer';
import { coreGeometry, deformPoint, fractureOpening, shellCells, shellGeometry, surfacePoint, radiusAt, TOY_SCALE, WAX_THICKNESS, type Outline } from './ToyGeometry';

interface Plate {
  mesh:THREE.Mesh<THREE.BufferGeometry,THREE.Material[]>;
  base:Float32Array; smooth:Float32Array; center:Point; origin:Point; damage:number; bend:number;
  detached:boolean; age:number; velocity:THREE.Vector3; spin:THREE.Vector3; landed:boolean;
}
export class WaxToyRenderer {
  readonly renderer:THREE.WebGLRenderer;
  private scene=new THREE.Scene();
  private camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,30);
  private ray=new THREE.Raycaster();
  private outline:Outline=[];
  private core:THREE.Mesh<THREE.BufferGeometry,THREE.MeshPhysicalMaterial>|null=null;
  private coreBase=new Float32Array();
  private plates:Plate[]=[];
  private shellMaterial:THREE.MeshPhysicalMaterial|null=null;
  private wallMaterial=new THREE.MeshPhysicalMaterial({color:'#efc9ac',roughness:.74,bumpScale:.006,side:THREE.DoubleSide});
  private texture:THREE.CanvasTexture|null=null;
  private grain:THREE.CanvasTexture;
  private environment:THREE.WebGLRenderTarget;
  private floor:THREE.Mesh;
  private marker:THREE.Mesh;
  private width=1;private height=1;private drawSize=1;
  private version=0;private disposed=false;
  private reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  ready=false;
  keyboardPoint:Point|null=null;

  constructor(private canvas:HTMLCanvasElement,readonly model:SquishyStateMachine) {
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    this.renderer.setClearColor(0,0);this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.88;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.camera.position.set(0,.18,6);this.camera.lookAt(0,0,0);
    const ambient=new THREE.HemisphereLight(0xfff4e5,0xd3bba2,.85);this.scene.add(ambient);
    const key=new THREE.DirectionalLight(0xfff1dd,1.8);key.position.set(-3,5,5);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-2;key.shadow.camera.right=2;key.shadow.camera.top=2;key.shadow.camera.bottom=-2;
    key.shadow.normalBias=.008;key.shadow.bias=-.0002;key.shadow.radius=3;this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xffe3ca,.45);fill.position.set(3,1,3);this.scene.add(fill);
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();
    this.environment=pmrem.fromScene(room,.06);this.scene.environment=this.environment.texture;room.dispose();pmrem.dispose();
    const floorMaterial=new THREE.ShadowMaterial({color:0x76503a,opacity:.25});
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),floorMaterial);this.floor.rotation.x=-Math.PI/2;this.floor.receiveShadow=true;this.scene.add(this.floor);
    this.marker=new THREE.Mesh(new THREE.TorusGeometry(.035,.004,6,24),new THREE.MeshBasicMaterial({color:0x76503c,depthTest:false}));this.marker.visible=false;this.marker.renderOrder=10;this.scene.add(this.marker);
    const grain=document.createElement('canvas');grain.width=grain.height=128;const ctx=grain.getContext('2d')!,pixels=ctx.createImageData(128,128);
    let seed=37;
    for(let i=0;i<128*128;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=110+(seed>>>26);pixels.data.set([n,n,n,255],i*4);}ctx.putImageData(pixels,0,0);
    this.grain=new THREE.CanvasTexture(grain);this.wallMaterial.bumpMap=this.grain;this.grain.wrapS=this.grain.wrapT=THREE.RepeatWrapping;this.grain.repeat.set(7,7);
    this.resize();window.addEventListener('resize',this.resize);
  }
  private resize=():void=>{
    const b=this.canvas.getBoundingClientRect();this.width=b.width||1;this.height=b.height||1;
    this.drawSize=Math.min(this.width*.87,this.height*.66,640);
    const worldHeight=this.height/this.drawSize*TOY_SCALE,worldWidth=worldHeight*this.width/this.height;
    const offset=worldHeight*.065;
    this.camera.left=-worldWidth/2;this.camera.right=worldWidth/2;this.camera.top=worldHeight/2+offset;this.camera.bottom=-worldHeight/2+offset;
    this.camera.updateProjectionMatrix();this.renderer.setSize(this.width,this.height,false);
  };
  get interactionSize():number {return this.drawSize;}
  isSolid=(u:number,v:number):boolean=>{
    if(!this.outline.length || !Number.isFinite(u+v))return false;
    return Math.hypot(u-.5,v-.5)<radiusAt(this.outline,Math.atan2(v-.5,u-.5));
  };
  async load(character:Character):Promise<void> {
    const version=++this.version;this.ready=false;
    const image=new Image();image.src=`./characters/${encodeURIComponent(character.image)}`;await image.decode();
    if(version!==this.version||this.disposed)return;
    const size=1024,raw=document.createElement('canvas');raw.width=raw.height=size;
    const ctx=raw.getContext('2d')!;ctx.drawImage(image,0,0,size,size);
    const data=ctx.getImageData(0,0,size,size).data;
    let minX=size,minY=size,maxX=0,maxY=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(data[(y*size+x)*4+3]>128){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    if(maxX<=minX)throw new Error('无法读取角色透明轮廓');
    const normalized=document.createElement('canvas');normalized.width=normalized.height=size;const nc=normalized.getContext('2d')!;
    const sw=maxX-minX+1,sh=maxY-minY+1,scale=size*.84/Math.max(sw,sh);
    nc.drawImage(raw,minX,minY,sw,sh,(size-sw*scale)/2,(size-sh*scale)/2,sw*scale,sh*scale);
    const alpha=nc.getImageData(0,0,size,size).data;
    // ponytail: fixed-view inflated silhouette; a sculpted asset is needed for arbitrary camera rotation.
    this.outline=[];
    for(let n=0;n<128;n++) {
      const angle=n/128*Math.PI*2;let radius=.02;
      for(let r=.02;r<.49;r+=1/size) {
        const x=Math.floor((.5+Math.cos(angle)*r)*size),y=Math.floor((.5+Math.sin(angle)*r)*size);
        if(alpha[(y*size+x)*4+3]<128)break;radius=r;
      }
      this.outline.push({x:.5+Math.cos(angle)*radius,y:.5+Math.sin(angle)*radius});
    }
    this.removeToy();
    this.texture=new THREE.CanvasTexture(normalized);this.texture.colorSpace=THREE.SRGBColorSpace;
    // Geometry uses image coordinates with v down, so disable the default texture flip.
    this.texture.flipY=false;this.texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
    this.shellMaterial=new THREE.MeshPhysicalMaterial({map:this.texture,color:'#dc9272',roughness:.32,clearcoat:.38,clearcoatRoughness:.2,envMapIntensity:.25,transmission:.045,thickness:WAX_THICKNESS,ior:1.44,attenuationColor:new THREE.Color('#f2bb95'),attenuationDistance:.2,bumpMap:this.grain,bumpScale:.0015,side:THREE.DoubleSide});
    // The source photograph supplies facial pigment only. Its baked white reflections
    // must not become albedo: illumination and highlights now come from the 3D surface.
    this.shellMaterial.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 pigment=texture2D(map,vMapUv);
          float faceRegion=(1.0-smoothstep(.17,.24,abs(vMapUv.x-.5)))
            *(1.0-smoothstep(.13,.20,abs(vMapUv.y-.47)));
          float darkPigment=(1.0-smoothstep(.28,.52,max(pigment.r,max(pigment.g,pigment.b))))*faceRegion;
          vec2 cheek=vec2(abs(vMapUv.x-.5)-.16,vMapUv.y-.53);
          float blush=exp(-dot(cheek*vec2(24.,32.),cheek*vec2(24.,32.)))*.17;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.68,.24,.14),blush);
          diffuseColor.rgb=mix(diffuseColor.rgb,pigment.rgb*.38,darkPigment);
        #endif
      `);
    };
    const material=new THREE.MeshPhysicalMaterial({color:'#e9c9a6',roughness:.56,clearcoat:.06,clearcoatRoughness:.48,bumpMap:this.grain,bumpScale:.004,envMapIntensity:.2});
    this.core=new THREE.Mesh(coreGeometry(this.outline),material);this.core.castShadow=true;this.core.receiveShadow=true;
    this.coreBase=new Float32Array(this.core.geometry.attributes.position.array);this.scene.add(this.core);
    this.plates=shellCells(this.outline).map(cell=>{
      const geometry=shellGeometry(this.outline,cell.polygon),mesh=new THREE.Mesh(geometry,[this.shellMaterial!,this.wallMaterial]);
      mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);
      const normals=geometry.attributes.normal,uv=geometry.attributes.uv,index=geometry.index!;
      const smooth=new Float32Array(normals.array),front=new Set<number>();
      for(let n=0;n<geometry.groups[0].count;n++)front.add(index.getX(n));
      for(const n of front) {
        const u=uv.getX(n),v=uv.getY(n),e=.0005;
        const du=surfacePoint(this.outline,u+e,v).sub(surfacePoint(this.outline,u-e,v));
        const dv=surfacePoint(this.outline,u,v+e).sub(surfacePoint(this.outline,u,v-e));
        const normal=dv.cross(du).normalize();smooth.set([normal.x,normal.y,normal.z],n*3);
      }
      return {mesh,smooth,base:new Float32Array(geometry.attributes.position.array),center:cell.center,origin:{...cell.center},damage:0,bend:0,detached:false,age:0,velocity:new THREE.Vector3(),spin:new THREE.Vector3(),landed:false};
    });
    this.floor.position.y=Math.min(...this.outline.map(p=>-(p.y-.5)*TOY_SCALE))-.045;
    this.model.isSolid=this.isSolid;this.ready=true;this.clear();
  }
  private removeToy():void {
    if(this.core){this.scene.remove(this.core);this.core.geometry.dispose();this.core.material.dispose();this.core=null;}
    for(const p of this.plates){this.scene.remove(p.mesh);p.mesh.geometry.dispose();}this.plates=[];
    this.texture?.dispose();this.shellMaterial?.dispose();
  }
  hitTest(x:number,y:number):Hit|null {
    if(!this.ready||!this.core||!Number.isFinite(x+y))return null;
    this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2(x/this.width*2-1,1-y/this.height*2),this.camera);
    const surfaces:THREE.Object3D[]=[this.core,...this.plates.filter(p=>!p.detached).map(p=>p.mesh)];
    const hit=this.ray.intersectObjects(surfaces,false)[0];
    if(!hit?.uv)return null;
    return {x:hit.uv.x,y:hit.uv.y,pan:clamp(x/this.width*2-1,-.8,.8)};
  }
  toScreen(p:Point):Point {
    if(!this.outline.length)return {x:this.width/2,y:this.height/2};
    const world=deformPoint(surfacePoint(this.outline,p.x,p.y),p.x,p.y,this.model);world.project(this.camera);
    return {x:(world.x+1)*this.width/2,y:(1-world.y)*this.height/2};
  }
  handleEvent(event:MaterialEvent):void {
    if(!this.ready)return;
    if(event.type==='press'||event.type==='shell_break') {
      for(const p of this.plates) {
        if(p.detached)continue;
        const distance=Math.hypot(p.center.x-event.x,p.center.y-event.y),local=influence(distance,.29);
        const fatigue=event.type==='press'&&this.model.pressCount>4?.09:0;
        if(local>0 && p.damage===0)p.origin={x:event.x,y:event.y};
        p.damage=clamp(p.damage+local*(event.type==='press'?.72:.36)+fatigue);
        if(event.type==='press'&&this.model.pressCount>=10)p.damage=1;
        if(p.damage>=.96)this.detach(p,event);
      }
      // Keep audio/contact state consistent with the actual shell coverage.
      for(let i=0;i<this.model.opened.length;i++) {
        const q=this.model.cellPoint(i);let nearest:Plate|undefined,best=Infinity;
        for(const p of this.plates){const d=(q.x-p.center.x)**2+(q.y-p.center.y)**2;if(d<best){best=d;nearest=p;}}
        if(nearest?.detached)this.model.opened[i]=1;
      }
      if(this.model.contact)this.model.contact.soft=!!this.model.opened[this.model.cellAt(event.x,event.y)];
    }
  }
  private detach(p:Plate,event:Hit):void {
    p.detached=true;p.age=0;
    const positions=p.mesh.geometry.attributes.position,center=new THREE.Vector3();
    for(let i=0;i<positions.count;i++)center.add(new THREE.Vector3().fromBufferAttribute(positions,i));center.divideScalar(positions.count);
    for(let i=0;i<positions.count;i++)positions.setXYZ(i,positions.getX(i)-center.x,positions.getY(i)-center.y,positions.getZ(i)-center.z);
    p.mesh.position.copy(center);positions.needsUpdate=true;p.mesh.geometry.computeBoundingSphere();
    const side=p.center.x-event.x;
    p.velocity.set(side*2.4,.15,.35);p.spin.set(1.3,side*5,side>0?-1.4:1.4);
    if(this.reducedMotion){p.mesh.visible=false;p.landed=true;}
  }
  update(dt:number):void {
    if(!this.ready||!this.core)return;
    dt=clamp(dt,0,.05);
    const geometry=this.core.geometry,position=geometry.attributes.position,uv=geometry.attributes.uv,back=geometry.attributes.back;
    for(let i=0;i<position.count;i++) {
      const base=new THREE.Vector3(this.coreBase[i*3],this.coreBase[i*3+1],this.coreBase[i*3+2]);
      const target=deformPoint(base,uv.getX(i),uv.getY(i),this.model,!!back.getX(i));
      const a=1-Math.exp(-dt/.055);position.setXYZ(i,THREE.MathUtils.lerp(position.getX(i),target.x,a),THREE.MathUtils.lerp(position.getY(i),target.y,a),THREE.MathUtils.lerp(position.getZ(i),target.z,a));
    }
    position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
    for(const p of this.plates) {
      if(p.detached) {
        p.age+=dt;
        if(!p.landed) {
          p.velocity.y-=dt*3.4;p.mesh.position.addScaledVector(p.velocity,dt);
          p.mesh.rotation.x+=p.spin.x*dt;p.mesh.rotation.y+=p.spin.y*dt;p.mesh.rotation.z+=p.spin.z*dt;
          if(p.mesh.position.y<this.floor.position.y+.06){p.mesh.position.y=this.floor.position.y+.06;p.landed=true;p.mesh.rotation.set(-Math.PI/2,0,p.mesh.rotation.z);this.model.fragment({x:p.center.x,y:p.center.y,pan:clamp(p.center.x*2-1,-.8,.8)},.18);}
        }
        if(p.age>3.5)p.mesh.visible=false;
        continue;
      }
      // ponytail: kinematic bending, not an elastic fracture solver; upgrade for volume conservation.
      p.bend+=(p.damage-p.bend)*(1-Math.exp(-dt/.075));
      const pos=p.mesh.geometry.attributes.position,uv=p.mesh.geometry.attributes.uv;
      // A material-space hinge at the outward edge; curvature grows toward the free edge.
      let hx=p.center.x-p.origin.x,hy=p.center.y-p.origin.y;const length=Math.hypot(hx,hy)||1;hx/=length;hy/=length;
      const centerBase=surfacePoint(this.outline,p.center.x,p.center.y);
      const centerDent=deformPoint(centerBase,p.center.x,p.center.y,this.model).z-centerBase.z;
      for(let i=0;i<pos.count;i++) {
        const u=uv.getX(i),v=uv.getY(i),base=new THREE.Vector3(p.base[i*3],p.base[i*3+1],p.base[i*3+2]);
        const target=deformPoint(base,u,v,this.model);
        const opening=fractureOpening(p.origin,u,v,p.bend);
        // Unreached edges share the core deformation and stay closed. Released
        // portions progressively recover the chip's rigid curved shape.
        target.z=THREE.MathUtils.lerp(target.z,base.z+centerDent,opening*.7);
        const along=(u-p.center.x)*hx+(v-p.center.y)*hy;
        const free=clamp((.075-along)/.15),bend=opening*free*free;
        // Real vertex displacement: widening crack + curling shell + preserved sidewall thickness.
        target.x+=hx*opening*.012+hx*bend*.018;
        target.y-=hy*opening*.012+hy*bend*.018;
        target.z+=bend*.055;
        // The bottom stays above the core; no coincident faces/z-fighting.
        target.z=Math.max(target.z,surfacePoint(this.outline,u,v).z*.12+WAX_THICKNESS);
        pos.setXYZ(i,target.x,target.y,target.z);
      }
      pos.needsUpdate=true;p.mesh.geometry.computeVertexNormals();
      const normals=p.mesh.geometry.attributes.normal;
      for(let i=0;i<normals.count;i++) {
        const blend=clamp(fractureOpening(p.origin,uv.getX(i),uv.getY(i),p.bend)*2),normal=new THREE.Vector3(normals.getX(i),normals.getY(i),normals.getZ(i));
        normal.multiplyScalar(blend).addScaledVector(new THREE.Vector3(p.smooth[i*3],p.smooth[i*3+1],p.smooth[i*3+2]),1-blend).normalize();
        normals.setXYZ(i,normal.x,normal.y,normal.z);
      }
      normals.needsUpdate=true;p.mesh.geometry.computeBoundingSphere();
    }
    this.marker.visible=!!this.keyboardPoint;
    if(this.keyboardPoint)this.marker.position.copy(deformPoint(surfacePoint(this.outline,this.keyboardPoint.x,this.keyboardPoint.y),this.keyboardPoint.x,this.keyboardPoint.y,this.model)).add(new THREE.Vector3(0,0,.06));
    this.renderer.render(this.scene,this.camera);
  }
  clear():void {
    if(this.core){this.core.geometry.attributes.position.array.set(this.coreBase);this.core.geometry.attributes.position.needsUpdate=true;}
    for(const p of this.plates){p.damage=p.bend=p.age=0;p.detached=p.landed=false;p.mesh.visible=true;p.mesh.position.set(0,0,0);p.mesh.rotation.set(0,0,0);p.mesh.geometry.attributes.position.array.set(p.base);p.mesh.geometry.attributes.position.needsUpdate=true;}
  }
  refresh():void { /* Render loop also refreshes keyboard focus and lighting. */ }
  dispose():void {
    this.disposed=true;this.version++;window.removeEventListener('resize',this.resize);this.removeToy();
    this.wallMaterial.dispose();this.grain.dispose();this.environment.dispose();
    this.floor.geometry.dispose();(this.floor.material as THREE.Material).dispose();
    this.marker.geometry.dispose();(this.marker.material as THREE.Material).dispose();this.renderer.dispose();
  }
}
