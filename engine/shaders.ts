/**
 * shaders.ts — GLSL ES 3.00 source for the star point-sprite renderer.
 *
 * The renderer draws every star as a single GL_POINT whose size is derived
 * from the star's data size + pulse. The fragment shader shapes each point
 * into a soft glowing disc (core + halo) and outputs premultiplied-style
 * additive color so a simple gl.ONE/gl.ONE blend reads as additive glow.
 */

export const STAR_VERT = `#version 300 es
in vec2 a_pos;
in float a_size;
in vec3 a_color;
in float a_pulse;

uniform mat3 u_view;
uniform float u_pixelRatio;
uniform float u_zoom;

out vec3 v_color;
out float v_pulse;

void main() {
  vec3 p = u_view * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  float size = (a_size * 6.0 + a_pulse * 8.0) * u_zoom * u_pixelRatio;
  gl_PointSize = min(size, 64.0 * u_pixelRatio);
  v_color = a_color;
  v_pulse = a_pulse;
}
`;

export const STAR_FRAG = `#version 300 es
precision mediump float;

in vec3 v_color;
in float v_pulse;

out vec4 outColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.5, 0.1, d);
  float halo = pow(max(1.0 - d * 2.0, 0.0), 3.0);
  float i = core + halo * (0.4 + v_pulse);
  outColor = vec4(v_color * i, i);
}
`;

// ─────────────────────────────────────────────────────────────────────────
// Effects shaders (Task 6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * RING — a unit-circle line strip transformed by (u_center, u_radius) in world
 * units, projected through the mat3 u_view. Used by both supernova rings
 * (additive, accent color) and star-death collapse rings (alpha-blended dark).
 * The vertex carries a unit position (cos,sin); the fragment just outputs the
 * flat u_color * u_alpha (premultiplied so additive and normal blends both read
 * correctly: additive ignores dst alpha, normal blend uses src alpha = u_alpha).
 */
export const RING_VERT = `#version 300 es
in vec2 a_unit;            // point on the unit circle
uniform mat3 u_view;
uniform vec2 u_center;     // world-space center
uniform float u_radius;    // world-space radius
void main() {
  vec2 world = u_center + a_unit * u_radius;
  vec3 p = u_view * vec3(world, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

export const RING_FRAG = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 outColor;
void main() {
  outColor = vec4(u_color * u_alpha, u_alpha);
}
`;

/**
 * TRAIL — comet ribbons + heads. Vertices are pre-transformed to WORLD space on
 * the CPU (the ribbon offset math needs world coords); this shader applies only
 * u_view. Per-vertex alpha tapers along the ribbon; color is the flat accent.
 * Head quads are emitted into the same buffer with full alpha. Additive blend.
 */
export const TRAIL_VERT = `#version 300 es
in vec2 a_pos;     // world-space position
in float a_alpha;  // per-vertex alpha (taper)
uniform mat3 u_view;
out float v_alpha;
void main() {
  vec3 p = u_view * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_alpha = a_alpha;
}
`;

export const TRAIL_FRAG = `#version 300 es
precision mediump float;
in float v_alpha;
uniform vec3 u_color;
out vec4 outColor;
void main() {
  outColor = vec4(u_color * v_alpha, v_alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────
// Post-process (bloom) shaders (Task 6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fullscreen triangle: 3 vertices covering clip space, no vertex buffer needed
 * (positions derived from gl_VertexID). v_uv is the [0,1] texture coordinate.
 */
export const FULLSCREEN_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  // gl_VertexID 0,1,2 -> a triangle that covers the [-1,1] clip square.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Bright-pass: keep only the over-threshold energy, scaled up. */
export const BRIGHT_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  vec3 b = max(c - 0.6, 0.0) * 1.6;
  outColor = vec4(b, 1.0);
}
`;

/**
 * Separable 9-tap Gaussian blur. u_dir is the per-texel step (1/w,0) for the
 * horizontal pass or (0,1/h) for the vertical pass.
 */
export const BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;   // texel step along the blur axis
out vec4 outColor;
const float w0 = 0.227027;
const float w1 = 0.1945946;
const float w2 = 0.1216216;
const float w3 = 0.054054;
const float w4 = 0.016216;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb * w0;
  c += texture(u_tex, v_uv + u_dir * 1.0).rgb * w1;
  c += texture(u_tex, v_uv - u_dir * 1.0).rgb * w1;
  c += texture(u_tex, v_uv + u_dir * 2.0).rgb * w2;
  c += texture(u_tex, v_uv - u_dir * 2.0).rgb * w2;
  c += texture(u_tex, v_uv + u_dir * 3.0).rgb * w3;
  c += texture(u_tex, v_uv - u_dir * 3.0).rgb * w3;
  c += texture(u_tex, v_uv + u_dir * 4.0).rgb * w4;
  c += texture(u_tex, v_uv - u_dir * 4.0).rgb * w4;
  outColor = vec4(c, 1.0);
}
`;

/** Composite: scene + bloom * strength. */
export const COMPOSITE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
out vec4 outColor;
void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  outColor = vec4(scene + bloom * u_bloomStrength, 1.0);
}
`;

/**
 * Watermark: a single textured quad positioned in clip space by a per-draw
 * (u_offset, u_scale) transform. The vertex shader expands gl_VertexID 0..3
 * into a unit quad; the fragment samples an alpha-only RGBA texture (the
 * pre-rendered "reporeel" wordmark) and applies a global u_alpha. Drawn after
 * the post composite with standard alpha blending. Export-only.
 */
export const WATERMARK_VERT = `#version 300 es
out vec2 v_uv;
uniform vec2 u_offset;   // clip-space center offset
uniform vec2 u_scale;    // clip-space half-extents
void main() {
  // gl_VertexID 0..3 -> two triangles via a triangle strip unit quad.
  vec2 q = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_uv = vec2(q.x, 1.0 - q.y); // flip v so texture top maps up
  vec2 p = (q * 2.0 - 1.0) * u_scale + u_offset;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const WATERMARK_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  outColor = vec4(c.rgb, c.a * u_alpha);
}
`;

/**
 * Compiles a vertex+fragment program. Throws an Error carrying the shader /
 * program info log on any failure so the caller can surface a readable message.
 */
export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create WebGL program");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  // Shaders can be detached/deleted after a successful link.
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL program link failed: ${log ?? "(no log)"}`);
  }

  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create WebGL shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`WebGL ${kind} shader compile failed: ${log ?? "(no log)"}`);
  }
  return shader;
}
