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
