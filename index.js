const util = require('util');
const fs = require('fs');
const querystring = require('querystring');
const got = require('got');
const convert = require('html-to-json-data');
const { text, attr, href, group } = require('html-to-json-data/definitions');
const splitArray = require('split-array');
const { lines: adieuaData } = require('japan-train-data');
const writeFile = util.promisify(fs.writeFile);

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php?' + [
  'format=json',
  'formatversion=2',
  'action=query',
  'prop=extracts|langlinks',
  'lllang=en',
  'lllimit=100',
  'exintro=',
  'explaintext=',
  'redirects',
].join('&');

const IGNORE_LINKS = [
  '日本の地域別鉄道路線一覧',
  '日本の廃止鉄道路線一覧',
  '日本の地理',
  '上川総合振興局',
  '渡島総合振興局',
  '石狩振興局',
];
const IGNORE_MATCHING = /[県市都通府部]$/;
const HIRAGANA_IN_BRACKETS = /([^（]+)（([^）]+)）/;
const ENGLISH_IN_HIRAGANA = /、英.*[:：]\s*(.*)/;

async function generateWikipediaList() {
  const wikipediaMainPage = await Promise.all([
    got('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%89%84%E9%81%93%E8%B7%AF%E7%B7%9A%E4%B8%80%E8%A6%A7_%E3%81%82-%E3%81%8B%E8%A1%8C'),
    got('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%89%84%E9%81%93%E8%B7%AF%E7%B7%9A%E4%B8%80%E8%A6%A7_%E3%81%95-%E3%81%AA%E8%A1%8C'),
    got('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%89%84%E9%81%93%E8%B7%AF%E7%B7%9A%E4%B8%80%E8%A6%A7_%E3%81%AF-%E3%82%8F%E8%A1%8C'),
    got('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9C%B0%E5%9F%9F%E5%88%A5%E9%89%84%E9%81%93%E8%B7%AF%E7%B7%9A%E4%B8%80%E8%A6%A7'),
  ]);
  const data = wikipediaMainPage.map((content) => convert(content.body, group('.mw-parser-output li', {
    text: text('a:first-child'),
    title: attr('a:first-child', 'title'),
    line: text(':self'),
    link: href('a:first-child', 'https://ja.wikipedia.org/wiki/'),
  })))
  .reduce((all, page) => all.concat(page), [])
  .filter((line) => line.text);

  const wikipages = [];
  const incompletePages = [];
  for (const chunk of splitArray(listOfTitles(data), 20)) {
    const titles = chunk.map((link) => link.substring(link.lastIndexOf('/') + 1));
    const requestUrl = `${WIKIPEDIA_API}&titles=${titles.join('|')}`;
    const { body } = await got(requestUrl);
    const { query } = JSON.parse(body);
    query.pages.forEach((page) => {
      const { title, extract = '', langlinks = [] } = page;
      // Because of redirects we might end up with duplicates
      if (wikipages.find((p) => p.title === title)) return;
      const enLangLink = langlinks.find((lang) => lang.lang === 'en') || {};

      if (!extract) console.log(`${title} does not have an extract`);
      // Format for extract is always line name, japanese brackets with hiragana
      const [,, hiragana = ''] = extract.match(HIRAGANA_IN_BRACKETS) || [];
      // Some hiragana contain the English name in it
      const [, englishInHiragana = ''] = hiragana.match(ENGLISH_IN_HIRAGANA) || [];

      const englishName = cleanRomaji(enLangLink.title || englishInHiragana);
      if (!englishName) incompletePages.push(title);

      wikipages.push({
        title,
        extract: extract ? extract.trim() : '',
        hiragana,
        english: englishName,
        page: `https://ja.wikipedia.org/wiki/${title}`,
      });
    });
  }

  const csv = ['title,english'].concat(incompletePages.map((title) => {
    const adieuaMatch = adieuaData.filter((line) => line.name.ja.includes(title) || title.includes(line.name.ja));
    const englishName = adieuaMatch.length === 1 ? adieuaMatch[0].name.en : '';
    return `${title},${englishName}`;
  }));

  return Promise.all([
    writeFile('./lines.json', JSON.stringify(wikipages, null, '  ')),
    writeFile('./manual_english_names.csv', csv.join('\n')),
  ]);
}

function listOfTitles(data) {
  // Note that because of nested links, `link` could be an array
  const flat = data.reduce((all, item) => all.concat(typeof item.link === 'string' ? [item.link] : item.link), []);
  const unique = [...new Set(flat.filter(Boolean))];
  return unique.map((link => {
    if (!link.startsWith('https://ja.wikipedia.org')) return;
    const title = link.substring(link.lastIndexOf('/') + 1);
    if (title.startsWith('#')) return;

    const cleanTitle = querystring.unescape(title);
    if (IGNORE_LINKS.includes(cleanTitle)) return;
    if (IGNORE_MATCHING.test(cleanTitle)) return;

    return title;
  })).filter(Boolean);
}

function cleanRomaji(name) {
  return name.replace(/ō/g, 'o').replace(/Ō/g, 'O').replace(/ū/g, 'u').split('#').pop();
}

async function generate() {
  await generateWikipediaList();
}

if (require.main === module) {
  generate();
}
