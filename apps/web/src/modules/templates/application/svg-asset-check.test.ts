import { describe, expect, it } from "vitest";

import { scanCssUrls } from "./css-url-scan";
import { srcsetUrls } from "./html-template-document";
import { HtmlTemplateImportError, prepareHtmlTemplate } from "./html-template-import";
import { svgAssetProblems } from "./svg-asset-check";
import { testDocument, testSource } from "./test/html-template-fixtures";

function problemsOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof HtmlTemplateImportError) return error.problems.join("\n");
    throw error;
  }
  return "";
}

describe("svgAssetProblems", () => {
  it.each([
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- heart --><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><path d="M0 0" clip-path="url(#c)" style="fill: red"/><use href="#c"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:image/png;base64,AA"/><style>.a{fill:url(#c)}</style></svg>',
    '<svg><text>Tom &amp; Jerry &lt;3 &quot;x&quot; &apos;y&apos; &gt;</text><rect fill="url(#g)" clip-path="url( #c )"/></svg>',
  ])("accepts a plain SVG image %#", (svg) => {
    expect(svgAssetProblems(svg)).toEqual([]);
  });

  it.each([
    ['<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>', "<script>"],
    ["<svg><SCRIPT>alert(1)</SCRIPT></svg>", "<script>"],
    ['<svg xmlns:h="x"><h:foreignObject><p/></h:foreignObject></svg>', "<foreignobject>"],
    ['<svg><ev:listener event="click" handler="#h"/></svg>', "<listener>"],
    ['<svg x:onload="go()"/>', "Event handler"],
    ['<svg><rect ONCLICK="go()"/></svg>', "Event handler"],
    ['<svg><a xlink:href="javascript:go()"><text>x</text></a></svg>', "Links may only"],
    ['<svg><image href="assets/photo.png"/></svg>', "Links may only"],
    ['<svg><set attributeName="href" to="https://x"/></svg>', "Animating a link"],
    ['<svg><animate attributeName="xlink:href" values="#a"/></svg>', "Animating a link"],
    ["<svg><style>@import url(x.css);</style></svg>", "@import"],
    ["<svg><style>.a{background:url(https://x/y)}</style></svg>", "url()"],
    ['<svg><rect style="fill:u\\72l(x)"/></svg>', "escapes"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', "well-formed"],
    ["<svg><![CDATA[<script>1</script>]]></svg>", "well-formed"],
    ['<svg><rect width="1" height="2"></svg', "well-formed"],
    ["<svg><text>1 < 2</text></svg>", "well-formed"],
    ["<svg><!-- open", "unterminated"],
    ["<html><body/></html>", "not an SVG"],
    ['<svg><rect style="fill:&#117;rl(https://x/f)"/></svg>', "Character references"],
    ['<svg><set attributeName="&#104;ref" to="#a"/></svg>', "Character references"],
    ["<svg><text>&nbsp;</text></svg>", "Character references"],
    ['<svg><rect fill="url(//evil.example/f.svg#f)"/></svg>', "url() may only"],
    ['<svg><rect clip-path="url(https://x/c)"/></svg>', "url() may only"],
    ["<svg><style>.a{fill:url(#c</style></svg>", "not properly closed"],
    ['<svg><rect style="fill:url(#c"/></svg>', "not properly closed"],
    ["just text", "not an SVG"],
    ["<svg><text>see http://evil.example</text></svg>", "External"],
  ])("refuses %s", (svg, expected) => {
    expect(svgAssetProblems(svg).join("\n")).toContain(expected);
  });
});

describe("importer URL rules", () => {
  it("refuses root-relative URLs with a readable message", () => {
    const problems = problemsOf(() =>
      prepareHtmlTemplate(
        testSource({ indexHtml: testDocument({ body: '<img src="/assets/photo.png">' }) }),
      ),
    );
    expect(problems).toContain(
      '<img src>: /assets/photo.png starts with "/"; write it relative to index.html (assets/...).',
    );
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(
          testSource({
            indexHtml: testDocument({
              defaults: {
                lines: [],
                person: { name: "x" },
                photo: "/assets/photo.png",
                startDate: "2024-01-01",
              },
            }),
          }),
        ),
      ),
    ).toContain("an image default must be a template file");
  });

  it.each([
    ['<p style="background: u\\72l(https://x)">x</p>', "CSS escapes"],
    ["<style>.a { content: '\\41' }</style>", "CSS escapes"],
    [
      "<p style=\"background-image: image-set('https://x/a.png' 1x)\">x</p>",
      "url(): only the template's own",
    ],
    [
      '<style>.a { background: -webkit-image-set("//x/a.png" 1x, url(assets/photo.png) 2x) }</style>',
      "url(): only the template's own",
    ],
    ['<style>.a { background: image-set("assets/missing.png" 1x) }</style>', "not a file"],
    // Probes of the second review: entity-spelled and presentation-attribute URLs, unclosed CSS.
    ['<p style="fill:&#117;rl(//evil.example/f.svg#f)">x</p>', "only the template's own"],
    [
      `<svg><rect fill="url(//evil.example/f.svg#f)"/><rect filter="url( 'https://x/f' )"/></svg>`,
      "<rect fill>",
    ],
    ['<svg><rect mask="url(https://x/m)"/></svg>', "<rect mask>"],
    ["<style>.a { background: url(assets/photo.png", "not properly closed"],
    ['<p style="background: url(">x</p>', "not properly closed"],
    ["<style>.a { background: url('assets/photo.png) }</style>", "not properly closed"],
    ['<style>.a { background: image-set("assets/photo.png 1x) }</style>', "not properly closed"],
    ['<svg><a href="#x"><set attributeName="href" to="/g/abc"/></a></svg>', "animating a link"],
    ['<svg><animate attributeName="&#104;ref" values="#a"/></svg>', "animating a link"],
    ['<svg><set attributeName="xlink:HREF" to="#b"/></svg>', "animating a link"],
  ])("refuses CSS %s", (body, expected) => {
    const problems = problemsOf(() =>
      prepareHtmlTemplate(testSource({ indexHtml: testDocument({ body }) })),
    );
    expect(problems).toContain(expected);
  });

  it("accepts image-set strings of template files and data: URLs", () => {
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(
          testSource({
            indexHtml: testDocument({
              body: "<p style=\"background: image-set('assets/photo.png' 1x, url(data:image/png;base64,AA) 2x)\">x</p>",
            }),
          }),
        ),
      ),
    ).toBe("");
  });

  it("splits srcset like a browser, keeping a data: URL with its comma", () => {
    expect(srcsetUrls("assets/a.png 1x, data:image/png;base64,AAAA 2x")).toEqual([
      "assets/a.png",
      "data:image/png;base64,AAAA",
    ]);
    expect(srcsetUrls(" a.png,b.png 2x ,, c.png 100w")).toEqual(["a.png,b.png", "c.png"]);
    expect(srcsetUrls("a.png, ")).toEqual(["a.png"]);
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(
          testSource({
            indexHtml: testDocument({
              body: '<img srcset="assets/photo.png 1x, data:image/png;base64,AAAA 2x">',
            }),
          }),
        ),
      ),
    ).toBe("");
  });
});

describe("URL attributes that also contain url( or image-set(", () => {
  it.each([
    '<img src="https://e.x/url(assets/photo.png)">',
    '<a href="javascript:alert(1)//url(assets/photo.png)">x</a>',
    '<a href="https://e.x/?url(assets/photo.png)">x</a>',
    '<img srcset="https://e.x/b.png 2x, url(assets/photo.png) 3x">',
    '<svg><use href="https://e.x/s.svg?url(assets/photo.png)#x"/></svg>',
    '<video poster="https://e.x/url(assets/photo.png)"></video>',
    "<img src=\"https://e.x/image-set('assets/photo.png')\">",
  ])("still checks %s as a URL", (body) => {
    expect(
      problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: testDocument({ body }) }))),
    ).not.toBe("");
  });
});

describe("scanCssUrls", () => {
  it.each([
    ["a { b: url(x.png) }", ["x.png"], false],
    ["a { b: url( 'x y.png' ) url(\"z.png\") }", ["x y.png", "z.png"], false],
    ["a { b: image-set('a.png' 1x, \"b.png\" 2x) }", ["a.png", "b.png"], false],
    ["a { b: url(x.png", [], true],
    ["a { b: url('x.png) }", [], true],
    ["a { b: url(x y) }", [], true],
    ["a { b: image-set('a.png' 1x", [], true],
    ["a { b: image-set('a.png 1x) }", [], true],
    ["a { b: url('x\ny') }", [], true],
  ])("scans %j", (css, urls, malformed) => {
    expect(scanCssUrls(css)).toEqual({ malformed, urls });
  });
});
