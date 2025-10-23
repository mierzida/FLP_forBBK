#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const logosRoot = path.join(root, 'src', 'assets', 'football-logos-main', 'logos');
  const outDir = path.join(root, 'data');
  const outFile = path.join(outDir, 'team-index.json');
  const publicOutDir = path.join(root, 'public', 'data');
  const publicOutFile = path.join(publicOutDir, 'team-index.json');

async function exists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch (e) {
    return false;
  }
}

function titleize(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function scan() {
  try {
    await fs.promises.mkdir(outDir, { recursive: true });
    const countryEntries = await fs.promises.readdir(logosRoot, { withFileTypes: true });
    const teams = [];
    for (const countryDirent of countryEntries) {
      if (!countryDirent.isDirectory()) continue;
      const country = countryDirent.name;
      const countryPath = path.join(logosRoot, country);
      const items = await fs.promises.readdir(countryPath, { withFileTypes: true });

      // svg files directly under country folder represent individual teams/clubs
      for (const item of items) {
        if (!item.isFile()) continue;
        if (!item.name.toLowerCase().endsWith('.svg')) continue;
        const svgPath = path.join('src', 'assets', 'football-logos-main', 'logos', country, item.name).replace(/\\/g, '/');
        const baseName = item.name.replace(/\.svg$/i, '');
        const slug = baseName; // filename without extension, already slug-like
        const englishName = titleize(slug);

        // find a same-named folder of sizes (e.g., logos/country/slug/128x128/) or any size folders that contain pngs with same baseName
        let chosenPng = null;
        // look for a directory that matches slug (some datasets put size dirs under a folder named after the svg)
        const possibleSubdir = path.join(countryPath, slug);
        if (await exists(possibleSubdir)) {
          const inner = await fs.promises.readdir(possibleSubdir, { withFileTypes: true });
          const sizeDirs = inner.filter(f => f.isDirectory() && /^\d+x\d+$/.test(f.name));
          const candidates = [];
          for (const sd of sizeDirs) {
            const filesInside = await fs.promises.readdir(path.join(possibleSubdir, sd.name));
            const png = filesInside.find(n => n.toLowerCase().endsWith('.png'));
            if (png) {
              const m = sd.name.match(/^(\d+)x(\d+)$/);
              if (!m) continue;
              const w = parseInt(m[1], 10);
              const h = parseInt(m[2], 10);
              candidates.push({ w, h, path: path.join('src', 'assets', 'football-logos-main', 'logos', country, slug, sd.name, png).replace(/\\/g, '/') });
            }
          }
          if (candidates.length > 0) {
            candidates.sort((a,b)=> (b.w*b.h) - (a.w*a.h));
            chosenPng = candidates[0].path;
          }
        }

        // fallback: look for any size folders under the country that include the same baseName.png
        if (!chosenPng) {
          const countryItems = items.filter(f => f.isDirectory() && /^\d+x\d+$/.test(f.name));
          const candidates = [];
          for (const sd of countryItems) {
            const sdPath = path.join(countryPath, sd.name);
            const inner = await fs.promises.readdir(sdPath);
            // try match png with same baseName
            const png = inner.find(n => n.toLowerCase() === `${baseName.toLowerCase()}.png` || n.toLowerCase().endsWith('.png'));
            if (png) {
              const m = sd.name.match(/^(\d+)x(\d+)$/);
              if (!m) continue;
              const w = parseInt(m[1], 10);
              const h = parseInt(m[2], 10);
              candidates.push({ w, h, path: path.join('src', 'assets', 'football-logos-main', 'logos', country, sd.name, png).replace(/\\/g, '/') });
            }
          }
          if (candidates.length > 0) {
            candidates.sort((a,b)=> (b.w*b.h) - (a.w*a.h));
            chosenPng = candidates[0].path;
          }
        }

        teams.push({
          id: `${country}/${slug}`,
          slug,
          country,
          englishName,
          logos: { svg: svgPath, png: chosenPng },
          aliases: [],
          normalized: [englishName.toLowerCase().replace(/[\s_]+/g,' '), country.toLowerCase()]
        });
      }
    }

    // sort by slug
    teams.sort((a,b)=> a.slug.localeCompare(b.slug));
    await fs.promises.mkdir(outDir, { recursive: true });
    await fs.promises.writeFile(outFile, JSON.stringify(teams, null, 2), 'utf8');
    // also write to public/data so packaged apps can fetch '/data/team-index.json'
    try {
      await fs.promises.mkdir(publicOutDir, { recursive: true });
      await fs.promises.writeFile(publicOutFile, JSON.stringify(teams, null, 2), 'utf8');
      console.log('Wrote', publicOutFile, 'for runtime use in packaged apps');
    } catch (e) {
      console.warn('Failed to write public data file:', e);
    }
    console.log('Wrote', outFile, 'with', teams.length, 'entries');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

scan();
