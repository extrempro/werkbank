import { describe, expect, it } from "vitest";
import { planResize, prepareImage, sizeProblem } from "./imageResize";

describe("planResize", () => {
  it("verkleinert ein breites Logo auf 800 Pixel und behält das Seitenverhältnis", () => {
    const plan = planResize({ width: 3000, height: 900 }, "logo");
    expect(plan.canvas).toEqual({ width: 800, height: 240 });
    expect(plan.redraw).toBe(true);
  });

  it("lässt ein kleines Logo unverändert und vergrößert nie", () => {
    const plan = planResize({ width: 320, height: 80 }, "logo");
    expect(plan.canvas).toEqual({ width: 320, height: 80 });
    expect(plan.redraw).toBe(false);
  });

  it("setzt ein Favicon quadratisch und das Bild mittig hinein", () => {
    const plan = planResize({ width: 600, height: 300 }, "favicon");
    expect(plan.canvas).toEqual({ width: 256, height: 256 });
    expect(plan.image).toEqual({ width: 256, height: 128 });
    expect(plan.redraw).toBe(true);
  });

  it("lässt ein passendes quadratisches Favicon unverändert", () => {
    expect(planResize({ width: 64, height: 64 }, "favicon").redraw).toBe(false);
    expect(planResize({ width: 100, height: 60 }, "favicon").canvas).toEqual({
      width: 100,
      height: 100,
    });
  });

  it("hält eine vorgegebene längste Kante ein", () => {
    expect(planResize({ width: 3000, height: 900 }, "logo", 400).canvas).toEqual({
      width: 400,
      height: 120,
    });
  });
});

describe("sizeProblem", () => {
  it("meldet nur Bilder, die zu klein sind", () => {
    expect(sizeProblem({ width: 8, height: 200 }, "logo")).toMatch(/zu klein/);
    expect(sizeProblem({ width: 5000, height: 5000 }, "logo")).toBeNull();
    expect(sizeProblem({ width: 16, height: 16 }, "favicon")).toMatch(/mindestens 32/);
    expect(sizeProblem({ width: 600, height: 40 }, "favicon")).toBeNull();
  });
});

describe("prepareImage", () => {
  it("schickt die Datei unverändert, wenn der Browser sie nicht zeichnen kann", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
    const result = await prepareImage(file, "logo", "auto", 1024);
    expect(result).toEqual({ base64: "iVBORw==", bytes: 4, changed: false });
  });
});
