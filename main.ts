const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");

if (gl === null) {
  alert(
    "Unable to initialize WebGL. Your browser or machine may not support it."
  );
  throw "";
}

gl.getExtension("OES_texture_float");
gl.getExtension("EXT_color_buffer_float");

// Set clear color to black, fully opaque
gl.clearColor(0.0, 0.0, 0.0, 1.0);
// Clear the color buffer with specified clear color
gl.clear(gl.COLOR_BUFFER_BIT);

//

//

type FBOSpec = ReturnType<typeof createFBO>;

const createFBO = (
  width: number,
  height: number,
  initData?: ArrayBufferView
) => {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    width,
    height,
    0,
    gl.RGBA,
    gl.FLOAT,
    initData ?? null
  ); // TODO Revisit formats

  // Set texture wrapping mode (for both S and T axes)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Set texture filtering mode (minification and magnification)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw "Framebuffer is incomplete: " + status;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { framebuffer, texture, width, height };
};

const bindFramebuffer = (fbo: FBOSpec) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
  gl.viewport(0, 0, fbo.width, fbo.height); // TODO needed?
};

const compileShader = (
  shaderSource: string,
  shaderType: GLenum
): WebGLShader => {
  const shader = gl.createShader(shaderType)!;
  gl.shaderSource(shader, shaderSource);
  gl.compileShader(shader);

  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!success) {
    throw "could not compile shader:" + gl.getShaderInfoLog(shader);
  }

  return shader;
};

const createProgram = (
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram => {
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!success) {
    throw "program failed to link:" + gl.getProgramInfoLog(program);
  }

  return program;
};

const fullScreenVertexShader = compileShader(
  `
attribute vec4 position;

void main() {
  gl_Position = position;
}
`,
  gl.VERTEX_SHADER
);
const fullScreenVertexBuffer = gl.createBuffer();
const fullScreenVertexBufferData = new Float32Array([
  -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0,
]);

//

//

const numParticles = 100;
const particleSize = 0.5;

const collisionsFBO = createFBO(numParticles, numParticles);
let positionsFBO = createFBO(
  numParticles,
  1,
  new Float32Array(
    new Array(numParticles)
      .fill(0)
      .map((v, i) => [50.0 + Math.random() * 5.0, 0.0 + i * 1.01, 0.0, 0.0])
      .flat()
  )
);
let newPositionsFBO = createFBO(numParticles, 1);

const collisionProgram = createProgram(
  fullScreenVertexShader,
  compileShader(
    /* GLSL */ `
precision mediump float;

uniform sampler2D positions;

void main() {
    vec4 a = texture2D(positions, vec2(gl_FragCoord.x / 100.0, 0.5));
    vec4 b = texture2D(positions, vec2(gl_FragCoord.y / 100.0, 0.5));
    vec4 ab = b - a;
    gl_FragColor = length(ab) == 0.0 ? vec4(0,0,0,0) : ((min(length(ab), 1.0) - 1.0) * normalize(ab));
}
`,
    gl.FRAGMENT_SHADER
  )
);

const positionProgram = createProgram(
  fullScreenVertexShader,
  compileShader(
    /* GLSL */ `
precision mediump float;

uniform sampler2D positions;
uniform sampler2D collisions;

void main() {
    vec4 sum = texture2D(positions, vec2(gl_FragCoord.x / 100.0, 0.5));
    for (int y = 0; y < 100; y++) {
        sum += texture2D(collisions, vec2(gl_FragCoord.x / 100.0, (float(y) + 0.5) / 100.0));
    }
    vec4 ret = sum + vec4(0, -0.2, 0, 0);
    gl_FragColor = vec4(clamp(ret.x, 40.0, 60.0), max(ret.y, 0.0), ret.z, ret.w);
}
`,
    gl.FRAGMENT_SHADER
  )
);

const computeCollisions = () => {
  gl.useProgram(collisionProgram);

  bindFramebuffer(collisionsFBO);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, positionsFBO.texture);
  gl.uniform1i(gl.getUniformLocation(collisionProgram, "positions"), 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, fullScreenVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, fullScreenVertexBufferData, gl.STATIC_DRAW);

  // TODO Only need to run this once or after bufferData each time?
  const fullScreenVertexAttribLoc = gl.getAttribLocation(
    collisionProgram,
    "position"
  );
  gl.enableVertexAttribArray(fullScreenVertexAttribLoc);
  gl.vertexAttribPointer(fullScreenVertexAttribLoc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const computePositions = () => {
  gl.useProgram(positionProgram);

  bindFramebuffer(newPositionsFBO);

  // gl.uniform1i(
  //   gl.getUniformLocation(positionProgram, "numParticles"),
  //   numParticles
  // );
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, positionsFBO.texture);
  gl.uniform1i(gl.getUniformLocation(positionProgram, "positions"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, collisionsFBO.texture);
  gl.uniform1i(gl.getUniformLocation(positionProgram, "collisions"), 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, fullScreenVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, fullScreenVertexBufferData, gl.STATIC_DRAW);

  // TODO Only need to run this once or after bufferData each time?
  const fullScreenVertexAttribLoc = gl.getAttribLocation(
    positionProgram,
    "position"
  );
  gl.enableVertexAttribArray(fullScreenVertexAttribLoc);
  gl.vertexAttribPointer(fullScreenVertexAttribLoc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

//

//

const collisionOutputCanvas = document.getElementById(
  "collision_output"
) as HTMLCanvasElement;
const collisionOutputCtx = collisionOutputCanvas.getContext("2d");
const displayCtx = (
  document.getElementById("display") as HTMLCanvasElement
).getContext("2d")!;
displayCtx.scale(10, 10);

const outputPositions = () => {
  bindFramebuffer(positionsFBO);
  const positionsOutput = new Float32Array(numParticles * 4);
  gl.readPixels(0, 0, numParticles, 1, gl.RGBA, gl.FLOAT, positionsOutput);
  // console.log(positionsOutput);
  // for (let i = 0; i < 12; i++) {
  //   positionOutputCtx?.putImageData(
  //     new ImageData(new Uint8ClampedArray(positionsOutput), numParticles),
  //     0,
  //     i
  //   );
  // }
  displayCtx.clearRect(0, 0, 1000, 1000);
  for (let i = 0; i < numParticles; i++) {
    displayCtx.beginPath();
    displayCtx.arc(
      positionsOutput[i * 4],
      100.0 - positionsOutput[i * 4 + 1],
      particleSize,
      0,
      Math.PI * 2
    );
    displayCtx.fillStyle = "green";
    displayCtx.fill();
    displayCtx.closePath();
  }
};

const outputCollisions = () => {
  bindFramebuffer(collisionsFBO);
  const collisionsOutput = new Float32Array(numParticles * numParticles * 4);
  gl.readPixels(
    0,
    0,
    numParticles,
    numParticles,
    gl.RGBA,
    gl.FLOAT,
    collisionsOutput
  );
  // console.log(collisionsOutput);
  collisionOutputCtx?.putImageData(
    new ImageData(
      new Uint8ClampedArray(
        [...collisionsOutput]
          .map((v) => Math.floor(v * 100) + 127)
          .map((v, i) => (i % 4 === 3 ? 255 : v))
      ),
      numParticles
    ),
    0,
    0
  );
};

const mainLoop = () => {
  computeCollisions();
  computePositions();

  const temp = newPositionsFBO;
  newPositionsFBO = positionsFBO;
  positionsFBO = temp;

  outputCollisions();
  outputPositions();

  requestAnimationFrame(mainLoop);
};

console.log("!!!");
outputPositions();
console.log("!!");

// Start the main loop
mainLoop();
