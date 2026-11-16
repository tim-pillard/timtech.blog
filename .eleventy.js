const { DateTime } = require("luxon");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const pluginSyntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const pluginNavigation = require("@11ty/eleventy-navigation");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");

module.exports = function(eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addPlugin(pluginSyntaxHighlight);
  eleventyConfig.addPlugin(pluginNavigation);

  eleventyConfig.setDataDeepMerge(true);

  eleventyConfig.addLayoutAlias("post", "layouts/post.njk");

  // American style, as newspapers write it (AP): "Nov. 7, 2023". Short months
  // (March to July) are spelled out, the others are abbreviated with a period.
  const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  eleventyConfig.addFilter("readableDate", dateObj => {
    const date = DateTime.fromJSDate(dateObj, {zone: 'utc'});
    return `${AP_MONTHS[date.month - 1]} ${date.day}, ${date.year}`;
  });

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  eleventyConfig.addFilter('htmlDateString', (dateObj) => {
    return DateTime.fromJSDate(dateObj, {zone: 'utc'}).toFormat('yyyy-LL-dd');
  });

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter("head", (array, n) => {
    if( n < 0 ) {
      return array.slice(n);
    }

    return array.slice(0, n);
  });

  // Tags, most recently used first; tags last used in the same article are
  // ordered by number of articles, then by name so the order is stable.
  eleventyConfig.addCollection("tagList", function(collection) {
    // this list should match the `filter` list in tags.njk
    const ignored = ["all", "nav", "post", "posts"];
    const stats = new Map();
    collection.getAll().forEach(function(item) {
      for (const tag of item.data.tags || []) {
        if (ignored.includes(tag)) continue;
        const stat = stats.get(tag) || { latest: 0, count: 0 };
        stat.latest = Math.max(stat.latest, item.date.getTime());
        stat.count++;
        stats.set(tag, stat);
      }
    });

    return [...stats.keys()].sort((a, b) =>
      stats.get(b).latest - stats.get(a).latest ||
      stats.get(b).count - stats.get(a).count ||
      a.localeCompare(b)
    );
  });

  // Images keep a stable address too (/img/...): feeds, share images and
  // Markdown copies link to it. Pages use the versioned copies below.
  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addWatchTarget("css");
  eleventyConfig.addWatchTarget("fonts");

  // Versioned assets: /css/index.css is published as
  // /assets/css/index.<content hash>.css, so /assets/* can be cached forever
  // (see _headers). Any change to a file gives it a new address.
  const OUTPUT_DIR = "_site";
  const versioned = new Map(); // source file -> { mtimeMs, url }

  // A stylesheet is hashed after its font addresses are versioned, so a font
  // change also changes the stylesheet's address.
  const assetContent = file => {
    const content = fs.readFileSync(file);
    if (path.extname(file) !== ".css") return content;
    return content.toString().replace(/url\("\.\.\/(fonts\/[^"]+)"\)/g, (match, font) =>
      `url("${assetUrl(font)}")`
    );
  };

  // Returns the versioned address of a source file ("css/index.css") and
  // writes the copy to the output directory.
  const assetUrl = file => {
    const { mtimeMs } = fs.statSync(file);
    const known = versioned.get(file);
    const target = url => path.join(OUTPUT_DIR, url);
    if (known && known.mtimeMs === mtimeMs && fs.existsSync(target(known.url))) return known.url;

    const content = assetContent(file);
    const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
    const { dir, name, ext } = path.parse(file);
    const url = `/assets/${dir}/${name}.${hash}${ext}`;
    fs.mkdirSync(path.dirname(target(url)), { recursive: true });
    fs.writeFileSync(target(url), content);
    versioned.set(file, { mtimeMs, url });
    return url;
  };

  // In HTML pages only: Markdown and templates keep the plain addresses.
  eleventyConfig.addTransform("versioned-assets", (content, outputPath) => {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    return content.replace(/\b(src|href)="\/((?:css|fonts|img)\/[^"]+)"/g, (match, attribute, file) =>
      fs.existsSync(file) ? `${attribute}="${assetUrl(file)}"` : match
    );
  });
  eleventyConfig.addPassthroughCopy("public");
  eleventyConfig.addPassthroughCopy("_redirects");
  eleventyConfig.addPassthroughCopy("_headers");

  /* Markdown Overrides */
  let markdownLibrary = markdownIt({
    html: true,
    breaks: true,
    linkify: true
  }).use(markdownItAnchor, {
    permalink: true,
    permalinkClass: "direct-link",
    permalinkSymbol: "#"
  });
  eleventyConfig.setLibrary("md", markdownLibrary);

  // Browsersync Overrides
  eleventyConfig.setBrowserSyncConfig({
    callbacks: {
      ready: function(err, browserSync) {
        const content_404 = fs.readFileSync('_site/404.html');

        browserSync.addMiddleware("*", (req, res) => {
          // Provides the 404 content without redirect.
          res.write(content_404);
          res.end();
        });
      },
    },
    ui: false,
    ghostMode: false
  });

  return {
    templateFormats: [
      "md",
      "njk",
      "html",
      "liquid",
      // Instruct eleventy to copy the ~favicon-related files.
      // Better to serve these from the root path.
      "ico",
      "svg",
      "png"
    ],

    // If your site lives in a different subdirectory, change this.
    // Leading or trailing slashes are all normalized away, so don’t worry about those.

    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for link URLs (it does not affect your file structure)
    // Best paired with the `url` filter: https://www.11ty.dev/docs/filters/url/

    // You can also pass this in on the command line using `--pathprefix`
    // pathPrefix: "/",

    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",

    // These are all optional, defaults are shown:
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site"
    }
  };
};
