/**
 * post.ts — BloomPipeline: an HDR-ish bloom post-process.
 *
 * Pipeline (high quality):
 *   1. Scene renders into FBO A (full-res color texture). We try a float color
 *      target (HALF_FLOAT via EXT_color_buffer_(half_)float) so bright additive
 *      stars can exceed 1.0 and bloom reads true HDR overbright. If float color
 *      buffers are unavailable we fall back to UNSIGNED_BYTE — visually the
 *      scene color is clamped to [0,1], so very bright cores bloom slightly less
 *      (no overbright headroom) but the effect still reads fine.
 *   2. Bright-pass into half-res FBO B: max(scene - 0.6, 0) * 1.6.
 *   3. Separable Gaussian blur (9-tap), 2 full passes: B->C (H), C->B (V), x2.
 *   4. Composite scene + bloom*strength to the default framebuffer via a single
 *      3-vertex fullscreen triangle (no quad).
 *
 * Low quality (setQuality("low")): bloom is skipped entirely. begin() binds the
 * default framebuffer directly and end() is a no-op, so the scene draws straight
 * to the screen with zero post cost.
 *
 * GL STATE CONTRACT: every pass binds its own program/FBO/textures (TEXTURE0/1
 * explicitly) and leaves BLEND disabled, depthMask true, program null, the
 * ARRAY_BUFFER/VAO unbound, and the default framebuffer bound on return.
 */

import {
  FULLSCREEN_VERT,
  BRIGHT_FRAG,
  BLUR_FRAG,
  COMPOSITE_FRAG,
  compileProgram,
} from "./shaders";

interface Fbo {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export type BloomQuality = "high" | "low";

export class BloomPipeline {
  private readonly gl: WebGL2RenderingContext;

  private readonly brightProgram: WebGLProgram;
  private readonly blurProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;
  private readonly emptyVao: WebGLVertexArrayObject; // for the attribute-less fullscreen tri

  private readonly uBrightTex: WebGLUniformLocation | null;
  private readonly uBlurTex: WebGLUniformLocation | null;
  private readonly uBlurDir: WebGLUniformLocation | null;
  private readonly uCompScene: WebGLUniformLocation | null;
  private readonly uCompBloom: WebGLUniformLocation | null;
  private readonly uCompStrength: WebGLUniformLocation | null;

  // Color texture format for the scene FBO.
  private readonly colorType: number; // gl.HALF_FLOAT or gl.UNSIGNED_BYTE
  private readonly colorInternal: number; // gl.RGBA16F or gl.RGBA8

  private fboA: Fbo | null = null; // full-res scene
  private fboB: Fbo | null = null; // half-res ping
  private fboC: Fbo | null = null; // half-res pong

  private width = 0;
  private height = 0;
  private quality: BloomQuality = "high";

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    this.brightProgram = compileProgram(gl, FULLSCREEN_VERT, BRIGHT_FRAG);
    this.blurProgram = compileProgram(gl, FULLSCREEN_VERT, BLUR_FRAG);
    this.compositeProgram = compileProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    this.emptyVao = vao;

    this.uBrightTex = gl.getUniformLocation(this.brightProgram, "u_tex");
    this.uBlurTex = gl.getUniformLocation(this.blurProgram, "u_tex");
    this.uBlurDir = gl.getUniformLocation(this.blurProgram, "u_dir");
    this.uCompScene = gl.getUniformLocation(this.compositeProgram, "u_scene");
    this.uCompBloom = gl.getUniformLocation(this.compositeProgram, "u_bloom");
    this.uCompStrength = gl.getUniformLocation(this.compositeProgram, "u_bloomStrength");

    // Detect a renderable float color target. RGBA16F needs the color-buffer
    // float extension to be attachable; linear sampling of half-float needs
    // OES_texture_half_float_linear (we sample bloom textures, so require it).
    const halfFloat =
      !!gl.getExtension("EXT_color_buffer_half_float") ||
      !!gl.getExtension("EXT_color_buffer_float");
    const halfLinear = !!gl.getExtension("OES_texture_half_float_linear");
    if (halfFloat && halfLinear) {
      this.colorType = gl.HALF_FLOAT;
      this.colorInternal = gl.RGBA16F;
    } else {
      this.colorType = gl.UNSIGNED_BYTE;
      this.colorInternal = gl.RGBA8;
    }
  }

  setQuality(q: BloomQuality): void {
    this.quality = q;
  }

  /** (Re)create FBOs at the given backing-store size. No-op on 0-size. */
  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return; // guard 0-size canvas
    if (w === this.width && h === this.height && this.fboA) return;
    this.width = w;
    this.height = h;

    this.destroyFbos();
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    this.fboA = this.createFbo(w, h, this.colorInternal, this.colorType);
    // Bloom buffers always use the same color format as the scene so sampling
    // is consistent (and linear filtering is available when float-linear is on).
    this.fboB = this.createFbo(hw, hh, this.colorInternal, this.colorType);
    this.fboC = this.createFbo(hw, hh, this.colorInternal, this.colorType);
  }

  /**
   * Bind the render target for the scene pass and set the viewport. In low
   * quality this binds the default framebuffer directly (no post).
   */
  begin(): void {
    const gl = this.gl;
    if (this.quality === "low" || !this.fboA) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fb);
    gl.viewport(0, 0, this.fboA.w, this.fboA.h);
  }

  /**
   * Run bright-pass + blur + composite to the screen. No-op in low quality
   * (scene already drew straight to the default framebuffer in begin()).
   */
  end(bloomStrength: number): void {
    if (this.quality === "low" || !this.fboA || !this.fboB || !this.fboC) return;
    const gl = this.gl;

    // Common state for all fullscreen passes.
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindVertexArray(this.emptyVao);

    // ── Bright-pass: scene (A) -> B (half-res) ──────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
    gl.viewport(0, 0, this.fboB.w, this.fboB.h);
    gl.useProgram(this.brightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform1i(this.uBrightTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Separable blur: 2 full passes (H: B->C, V: C->B) ────────────────────
    const dxStep = 1 / this.fboB.w;
    const dyStep = 1 / this.fboB.h;
    gl.useProgram(this.blurProgram);
    gl.uniform1i(this.uBlurTex, 0);
    for (let pass = 0; pass < 2; pass++) {
      // Horizontal: B -> C
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboC.fb);
      gl.viewport(0, 0, this.fboC.w, this.fboC.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboB.tex);
      gl.uniform2f(this.uBlurDir, dxStep, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Vertical: C -> B
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
      gl.viewport(0, 0, this.fboB.w, this.fboB.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboC.tex);
      gl.uniform2f(this.uBlurDir, 0, dyStep);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ── Composite: scene (A) + bloom (B) -> default framebuffer ─────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform1i(this.uCompScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fboB.tex);
    gl.uniform1i(this.uCompBloom, 1);
    gl.uniform1f(this.uCompStrength, bloomStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Restore contract defaults (TEXTURE0 active, nothing bound, vao null).
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    this.destroyFbos();
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteProgram(this.brightProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private createFbo(w: number, h: number, internal: number, type: number): Fbo {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error("Failed to create FBO resources");

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private destroyFbos(): void {
    const gl = this.gl;
    for (const f of [this.fboA, this.fboB, this.fboC]) {
      if (f) {
        gl.deleteFramebuffer(f.fb);
        gl.deleteTexture(f.tex);
      }
    }
    this.fboA = null;
    this.fboB = null;
    this.fboC = null;
  }
}
