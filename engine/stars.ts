/**
 * stars.ts — point-sprite star field. Owns the GL program, VAO and the four
 * per-star attribute buffers (pos, size, color, pulse). All buffers are
 * DYNAMIC_DRAW: per-frame data is re-uploaded via bufferSubData once the
 * buffers have been sized, and reallocated (bufferData) only when the star
 * count grows beyond current capacity.
 *
 * GL STATE CONTRACT (enforced by every render pass, including future ones):
 *   Each render pass sets ALL GL state it needs (program, blend, depthMask,
 *   VAO, etc.) and RESTORES blend/depthMask/program to their defaults
 *   (BLEND disabled, depthMask true, program null) before returning.
 *   This keeps passes composable and order-independent for future
 *   supernova/comet/bloom passes that will be inserted after starField.draw().
 */

import { STAR_VERT, STAR_FRAG, compileProgram } from "./shaders";

export class StarField {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;

  private readonly posBuf: WebGLBuffer;
  private readonly sizeBuf: WebGLBuffer;
  private readonly colorBuf: WebGLBuffer;
  private readonly pulseBuf: WebGLBuffer;

  private readonly uView: WebGLUniformLocation | null;
  private readonly uPixelRatio: WebGLUniformLocation | null;
  private readonly uZoom: WebGLUniformLocation | null;

  // Current GPU buffer capacity (in stars). 0 = not yet allocated.
  private capacity = 0;
  private count = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, STAR_VERT, STAR_FRAG);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    this.vao = vao;

    this.posBuf = createBuffer(gl);
    this.sizeBuf = createBuffer(gl);
    this.colorBuf = createBuffer(gl);
    this.pulseBuf = createBuffer(gl);

    const aPos = gl.getAttribLocation(this.program, "a_pos");
    const aSize = gl.getAttribLocation(this.program, "a_size");
    const aColor = gl.getAttribLocation(this.program, "a_color");
    const aPulse = gl.getAttribLocation(this.program, "a_pulse");

    gl.bindVertexArray(vao);
    bindAttrib(gl, this.posBuf, aPos, 2);
    bindAttrib(gl, this.sizeBuf, aSize, 1);
    bindAttrib(gl, this.colorBuf, aColor, 3);
    bindAttrib(gl, this.pulseBuf, aPulse, 1);
    gl.bindVertexArray(null);

    this.uView = gl.getUniformLocation(this.program, "u_view");
    this.uPixelRatio = gl.getUniformLocation(this.program, "u_pixelRatio");
    this.uZoom = gl.getUniformLocation(this.program, "u_zoom");
  }

  /** Upload per-star data. Grows GPU buffers (bufferData) when count exceeds
   *  capacity; otherwise updates in place (bufferSubData). */
  upload(
    positions: Float32Array,
    sizes: Float32Array,
    colors: Float32Array,
    pulses: Float32Array,
    count: number
  ): void {
    const gl = this.gl;
    this.count = count;

    if (count > this.capacity) {
      // Grow: (re)allocate each buffer to fit the new count.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pulseBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pulses, gl.DYNAMIC_DRAW);
      this.capacity = count;
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions, 0, count * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizes, 0, count);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors, 0, count * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pulseBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pulses, 0, count);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Draw all stars with additive blending. `view` is a column-major mat3. */
  draw(view: Float32Array, pixelRatio: number, zoom: number): void {
    if (this.count === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniformMatrix3fv(this.uView, false, view);
    gl.uniform1f(this.uPixelRatio, pixelRatio);
    gl.uniform1f(this.uZoom, zoom);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive
    gl.depthMask(false);

    gl.drawArrays(gl.POINTS, 0, this.count);

    // Restore GL defaults so the next render pass starts from a clean state
    // (see GL STATE CONTRACT at the top of this file).
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.sizeBuf);
    gl.deleteBuffer(this.colorBuf);
    gl.deleteBuffer(this.pulseBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const b = gl.createBuffer();
  if (!b) throw new Error("Failed to create GL buffer");
  return b;
}

function bindAttrib(
  gl: WebGL2RenderingContext,
  buf: WebGLBuffer,
  loc: number,
  size: number
): void {
  if (loc < 0) return; // attribute optimized out — skip
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}
