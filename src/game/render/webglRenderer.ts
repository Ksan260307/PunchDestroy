/**
 * 石像を立体のまま描く。
 *
 * マスごとの残り量を1枚の立体画像として送り込み、画面の各点から線を伸ばして
 * 最初にぶつかった面を求める。空の区画は粗い占有表でまとめて飛ばすので、
 * 実際に見る点はごくわずかで済む。描画命令は「石像1回＋破片1回」だけ。
 */

import { BLOCKS, BLOCK_COUNT, GRID } from '../../core/constants';
import { getStatueShape } from '../../core/shape';
import { MAX_GLOW_POINTS } from '../effects';
import type { RenderFrame, Renderer } from './types';

const NEAR = '0.5';
const FAR = '8.5';

const QUAD_VERT = `#version 300 es
in vec2 aCorner;
out vec2 vUv;
void main() {
  vUv = aCorner;
  gl_Position = vec4(aCorner * 2.0 - 1.0, 0.0, 1.0);
}`;

const STATUE_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D uNow;
uniform sampler3D uMeta;
uniform sampler3D uCoarse;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTan;
uniform vec2 uShake;
uniform vec4 uGlow[${MAX_GLOW_POINTS}];
uniform float uRush;
uniform float uTime;
uniform float uCenterY;

in vec2 vUv;
out vec4 outColor;

const float BOUND = 1.06;
const float VOXEL = 2.0 / ${GRID}.0;
const float COARSE = 2.0 / ${BLOCKS}.0;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
        mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
        mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float density(vec3 p) {
  return texture(uNow, p * 0.5 + 0.5).r;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0 + uShake;
  vec3 rd = normalize(uCamFwd + uCamRight * (ndc.x * uTan.x) + uCamUp * (ndc.y * uTan.y));
  vec3 ro = uCamPos;

  float b = dot(ro, rd);
  float c = dot(ro, ro) - BOUND * BOUND;
  float disc = b * b - c;
  if (disc <= 0.0) discard;
  float root = sqrt(disc);
  float t = max(-b - root, 0.0);
  float tEnd = -b + root;
  if (tEnd <= 0.0) discard;

  bool hit = false;
  float tPrev = t;
  for (int i = 0; i < 220; i++) {
    if (t > tEnd) break;
    vec3 p = ro + rd * t;
    if (texture(uCoarse, p * 0.5 + 0.5).r < 0.5) {
      tPrev = t;
      t += COARSE * 0.4;
      continue;
    }
    if (density(p) > 0.5) { hit = true; break; }
    tPrev = t;
    t += VOXEL * 0.8;
  }
  if (!hit) discard;

  // 直前の「空だった位置」との間をはさみうちで詰める
  float ta = tPrev;
  float tb = t;
  for (int i = 0; i < 7; i++) {
    float tm = (ta + tb) * 0.5;
    if (density(ro + rd * tm) > 0.5) tb = tm; else ta = tm;
  }
  t = tb;
  vec3 p = ro + rd * t;
  vec3 tc = p * 0.5 + 0.5;

  float e = 1.0 / ${GRID}.0;
  vec3 grad = vec3(
    texture(uNow, tc + vec3(e, 0.0, 0.0)).r - texture(uNow, tc - vec3(e, 0.0, 0.0)).r,
    texture(uNow, tc + vec3(0.0, e, 0.0)).r - texture(uNow, tc - vec3(0.0, e, 0.0)).r,
    texture(uNow, tc + vec3(0.0, 0.0, e)).r - texture(uNow, tc - vec3(0.0, 0.0, e)).r);
  float glen = length(grad);
  vec3 normal = glen > 0.0004 ? -grad / glen : -rd;

  // 石らしいざらつきを面の向きに乗せる
  vec3 cell = floor(p * 110.0);
  vec3 jitter = vec3(hash31(cell), hash31(cell + 11.3), hash31(cell + 27.7)) - 0.5;
  normal = normalize(normal + jitter * 0.15);

  uint packed = uint(texture(uMeta, tc).r * 255.0 + 0.5);
  uint kind = packed & 3u;
  // 深さはマス単位の整数なので、少し散らして層の境目を目立たなくする
  float depth = float(packed >> 2u) + (hash31(floor(p * 260.0)) - 0.5) * 1.7;

  // もとの表面はマスの中心の取り方で 0〜2 くらいにばらつくので、そこは全部塗り面にする
  float paint = 1.0 - smoothstep(2.6, 6.5, depth);
  float coreDist = length(p - vec3(0.0, uCenterY, 0.0));
  float core = smoothstep(0.44, 0.18, coreDist);

  vec3 albedo;
  if (kind == 2u) albedo = vec3(0.46, 0.33, 0.20);
  else if (kind == 3u) albedo = vec3(0.34, 0.58, 0.28);
  else {
    albedo = mix(vec3(0.62, 0.61, 0.63), vec3(0.84, 0.14, 0.17), paint);
    albedo = mix(albedo, vec3(0.46, 0.45, 0.48), smoothstep(6.0, 26.0, depth) * 0.45);
    albedo = mix(albedo, vec3(1.0, 0.68, 0.22), core * 0.9);
  }
  albedo *= 0.92 + 0.16 * hash31(floor(p * 150.0));

  vec3 key = normalize(vec3(-0.42, 0.78, 0.46));
  float ndl = max(dot(normal, key), 0.0);
  // 明るい背景に合わせて、まわりからの回り込みを強めにとる
  float sky = 0.5 + 0.5 * normal.y;
  vec3 ambient = mix(vec3(0.36, 0.34, 0.38), vec3(0.76, 0.78, 0.84), sky);
  vec3 halfway = normalize(key - rd);
  float gloss = kind == 1u ? 0.30 : 0.16;
  float spec = pow(max(dot(normal, halfway), 0.0), 24.0) * gloss;
  float ao = 1.0 - 0.3 * smoothstep(5.0, 26.0, depth);

  vec3 color = albedo * (ambient + vec3(1.06, 1.0, 0.94) * ndl) * ao;
  color += spec * vec3(1.0, 0.97, 0.92);

  float glow = 0.0;
  for (int i = 0; i < ${MAX_GLOW_POINTS}; i++) {
    vec4 g = uGlow[i];
    if (g.w > 0.01) {
      vec3 d = p - g.xyz;
      glow += g.w * exp(-dot(d, d) * 85.0);
    }
  }
  if (glow > 0.004) {
    float veins = pow(max(0.0, 1.0 - abs(noise3(p * 34.0) * 2.0 - 1.0)), 10.0);
    color += glow * glow * vec3(1.35, 0.42, 0.10) * (0.35 + veins * 2.4) * (1.0 + uRush);
  }
  color += core * vec3(0.85, 0.42, 0.10) * (0.22 + 0.14 * sin(uTime * 4.0));
  color += uRush * vec3(0.10, 0.02, 0.03);

  float viewDepth = t * dot(rd, uCamFwd);
  gl_FragDepth = clamp((viewDepth - ${NEAR}) / (${FAR} - ${NEAR}), 0.0, 1.0);
  outColor = vec4(color, 1.0);
}`;

const PARTICLE_VERT = `#version 300 es
in vec2 aCorner;
in vec4 aPosSize;
in vec4 aColor;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTan;
uniform vec2 uShake;
out vec4 vColor;
out vec2 vLocal;
void main() {
  vec3 world = aPosSize.xyz + (uCamRight * aCorner.x + uCamUp * aCorner.y) * aPosSize.w;
  vec3 v = world - uCamPos;
  float depth = dot(v, uCamFwd);
  vColor = aColor;
  vLocal = aCorner;
  if (depth < ${NEAR}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float nx = dot(v, uCamRight) / (depth * uTan.x);
  float ny = dot(v, uCamUp) / (depth * uTan.y);
  float z = clamp((depth - ${NEAR}) / (${FAR} - ${NEAR}), 0.0, 1.0);
  gl_Position = vec4(nx - uShake.x, ny - uShake.y, z * 2.0 - 1.0, 1.0);
}`;

const PARTICLE_FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vLocal;
out vec4 outColor;
void main() {
  float hot = step(1.5, vColor.a);
  float a = vColor.a - hot * 2.0;
  float shape = smoothstep(0.5, 0.22, length(vLocal));
  float alpha = a * shape;
  if (alpha < 0.01) discard;
  outColor = vec4(vColor.rgb * alpha * (1.0 + hot * 2.0), alpha * (1.0 - hot * 0.8));
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('シェーダを作成できません');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`シェーダのコンパイルに失敗: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('プログラムを作成できません');
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`プログラムのリンクに失敗: ${log}`);
  }
  return program;
}

type UniformMap = Record<string, WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): UniformMap {
  const map: UniformMap = {};
  for (const name of names) map[name] = gl.getUniformLocation(program, name);
  return map;
}

const CAMERA_UNIFORMS = ['uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd', 'uTan', 'uShake'];

export class WebGLRenderer implements Renderer {
  readonly kind = 'webgl' as const;

  private readonly gl: WebGL2RenderingContext;
  private readonly statue: WebGLProgram;
  private readonly statueU: UniformMap;
  private readonly particles: WebGLProgram;
  private readonly particlesU: UniformMap;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly particleVao: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly texNow: WebGLTexture;
  private readonly texMeta: WebGLTexture;
  private readonly texCoarse: WebGLTexture;
  private readonly coarseData = new Uint8Array(BLOCK_COUNT);

  private width = 1;
  private height = 1;
  private wholeDirty = true;
  private hasBox = false;
  private bx0 = 0;
  private by0 = 0;
  private bz0 = 0;
  private bx1 = 0;
  private by1 = 0;
  private bz1 = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('この環境では立体表示を使えません');
    this.gl = gl;

    this.statue = link(gl, QUAD_VERT, STATUE_FRAG);
    this.statueU = uniforms(gl, this.statue, [
      ...CAMERA_UNIFORMS,
      'uNow',
      'uMeta',
      'uCoarse',
      'uGlow[0]',
      'uRush',
      'uTime',
      'uCenterY',
    ]);
    this.particles = link(gl, PARTICLE_VERT, PARTICLE_FRAG);
    this.particlesU = uniforms(gl, this.particles, CAMERA_UNIFORMS);

    this.quadVao = this.makeQuadVao(this.statue);
    this.texNow = this.makeVolume(gl.LINEAR);
    this.texMeta = this.makeVolume(gl.NEAREST);
    this.texCoarse = this.makeCoarse();

    const shape = getStatueShape();
    gl.bindTexture(gl.TEXTURE_3D, this.texMeta);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      0,
      0,
      0,
      GRID,
      GRID,
      GRID,
      gl.RED,
      gl.UNSIGNED_BYTE,
      shape.material,
    );

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('描画設定を作成できません');
    this.particleVao = vao;
    gl.bindVertexArray(vao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    const cornerLoc = gl.getAttribLocation(this.particles, 'aCorner');
    gl.enableVertexAttribArray(cornerLoc);
    gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);

    const instances = gl.createBuffer();
    if (!instances) throw new Error('描画設定を作成できません');
    this.instanceBuffer = instances;
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, 3600 * 8 * 4, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(this.particles, 'aPosSize');
    const colorLoc = gl.getAttribLocation(this.particles, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(posLoc, 1);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(colorLoc, 1);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeQuadVao(program: WebGLProgram): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('描画設定を作成できません');
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private makeVolume(filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('画像領域を作成できません');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, GRID, GRID, GRID);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeCoarse(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('画像領域を作成できません');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, BLOCKS, BLOCKS, BLOCKS);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  invalidate(): void {
    this.wholeDirty = true;
    this.hasBox = false;
  }

  markDirty(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (this.wholeDirty) return;
    if (!this.hasBox) {
      this.hasBox = true;
      this.bx0 = x0;
      this.by0 = y0;
      this.bz0 = z0;
      this.bx1 = x1;
      this.by1 = y1;
      this.bz1 = z1;
      return;
    }
    if (x0 < this.bx0) this.bx0 = x0;
    if (y0 < this.by0) this.by0 = y0;
    if (z0 < this.bz0) this.bz0 = z0;
    if (x1 > this.bx1) this.bx1 = x1;
    if (y1 > this.by1) this.by1 = y1;
    if (z1 > this.bz1) this.bz1 = z1;
  }

  render(frame: RenderFrame): void {
    const gl = this.gl;
    const fx = frame.fx;
    const view = frame.view;
    const camera = frame.camera;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.uploadVolume(view.density);
    this.uploadCoarse(view.blockRemaining);

    const shape = getStatueShape();
    const shakeX = (fx.shakeX / this.width) * 2;
    const shakeY = (-fx.shakeY / this.height) * 2;
    const tanX = camera.tanHalf * camera.aspect * fx.zoom;
    const tanY = camera.tanHalf * fx.zoom;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.useProgram(this.statue);
    this.setCamera(this.statueU, camera, tanX, tanY, shakeX, shakeY);
    gl.uniform1i(this.statueU.uNow!, 0);
    gl.uniform1i(this.statueU.uMeta!, 1);
    gl.uniform1i(this.statueU.uCoarse!, 2);
    gl.uniform4fv(this.statueU['uGlow[0]']!, fx.glowPoints);
    gl.uniform1f(this.statueU.uRush!, fx.rushGlow);
    gl.uniform1f(this.statueU.uTime!, frame.time);
    gl.uniform1f(this.statueU.uCenterY!, shape.centerY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texNow);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.texMeta);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.texCoarse);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const count = fx.packInstances();
    if (count > 0) {
      gl.depthMask(false);
      gl.useProgram(this.particles);
      this.setCamera(this.particlesU, camera, tanX, tanY, shakeX, shakeY);
      gl.bindVertexArray(this.particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, fx.instances.subarray(0, count * 8));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  private setCamera(
    map: UniformMap,
    camera: RenderFrame['camera'],
    tanX: number,
    tanY: number,
    shakeX: number,
    shakeY: number,
  ): void {
    const gl = this.gl;
    gl.uniform3f(map.uCamPos!, camera.px, camera.py, camera.pz);
    gl.uniform3f(map.uCamRight!, camera.rx, camera.ry, camera.rz);
    gl.uniform3f(map.uCamUp!, camera.ux, camera.uy, camera.uz);
    gl.uniform3f(map.uCamFwd!, camera.fx, camera.fy, camera.fz);
    gl.uniform2f(map.uTan!, tanX, tanY);
    gl.uniform2f(map.uShake!, shakeX, shakeY);
  }

  private uploadVolume(data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.texNow);

    if (this.wholeDirty) {
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, GRID, GRID, GRID, gl.RED, gl.UNSIGNED_BYTE, data);
      this.wholeDirty = false;
      this.hasBox = false;
      return;
    }
    if (!this.hasBox) return;

    const w = this.bx1 - this.bx0 + 1;
    const h = this.by1 - this.by0 + 1;
    const d = this.bz1 - this.bz0 + 1;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, GRID);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, GRID);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, this.bx0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, this.by0);
    gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, this.bz0);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      this.bx0,
      this.by0,
      this.bz0,
      w,
      h,
      d,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    this.hasBox = false;
  }

  private uploadCoarse(blockRemaining: Int32Array): void {
    const gl = this.gl;
    let changed = false;
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const value = blockRemaining[i] > 0 ? 255 : 0;
      if (this.coarseData[i] !== value) {
        this.coarseData[i] = value;
        changed = true;
      }
    }
    if (!changed) return;
    gl.bindTexture(gl.TEXTURE_3D, this.texCoarse);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      0,
      0,
      0,
      BLOCKS,
      BLOCKS,
      BLOCKS,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.coarseData,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.statue);
    gl.deleteProgram(this.particles);
    gl.deleteTexture(this.texNow);
    gl.deleteTexture(this.texMeta);
    gl.deleteTexture(this.texCoarse);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteVertexArray(this.particleVao);
  }
}
