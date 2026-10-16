// Synthetic lyrics only. Produces a real indexed SQLite file and gzip for UI QA.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
const directory = resolve('output/playwright/lrclib-local');
mkdirSync(directory, { recursive: true });
const name = resolve(directory, 'fixture.sqlite3');
const db = new DatabaseSync(name);
db.exec(`
  PRAGMA journal_mode=WAL;
  DROP TABLE IF EXISTS tracks; DROP TABLE IF EXISTS lyrics;
  CREATE TABLE tracks (id INTEGER PRIMARY KEY, name TEXT, name_lower TEXT,
    artist_name TEXT, artist_name_lower TEXT, album_name TEXT, album_name_lower TEXT,
    duration REAL, last_lyrics_id INTEGER, UNIQUE(name_lower,artist_name_lower,album_name_lower,duration));
  CREATE TABLE lyrics (id INTEGER PRIMARY KEY, track_id INTEGER, instrumental BOOLEAN,
    plain_lyrics TEXT, synced_lyrics TEXT, lyricsfile TEXT);
`);
const track = db.prepare('INSERT INTO tracks VALUES(?,?,?,?,?,?,?,?,?)');
const lyric = db.prepare('INSERT INTO lyrics VALUES(?,?,?,?,?,?)');
const cases = [
  [1, 'Offline Settings Song', 'offline settings song', 'Fixture Artist', 'fixture artist', 'Fixture Album', 'fixture album', 180, 101,
    0, 'Local first line\nLocal second line', '[00:01.00]Local first line\n[00:02.00]Local second line', null],
  [2, 'Café - Song', 'cafe song', 'Beyoncé', 'beyonce', 'Album', 'album', 180.2, 102,
    0, 'Café local lyrics', '[00:00.50]Café local lyrics', null],
  [3, 'Instrumental', 'instrumental', 'Fixture Artist', 'fixture artist', '', '', 180, 103, 1, null, null, null],
  [4, 'Long Song', 'long song', 'Fixture Artist', 'fixture artist', '', '', 180, 104,
    0, 'x'.repeat(40000), null, null],
];
for (const value of cases) {
  track.run(...value.slice(0, 9));
  lyric.run(value[8], value[0], ...value.slice(9));
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
writeFileSync(resolve(directory, 'fixture.sqlite3.gz'), gzipSync(readFileSync(name)));
writeFileSync(resolve(directory, 'invalid.sqlite3.gz'), new Uint8Array(1024));
const wrong = new DatabaseSync(resolve(directory, 'wrong-schema.sqlite3'));
wrong.exec('CREATE TABLE IF NOT EXISTS unrelated(value TEXT)'); wrong.close();
console.log(JSON.stringify({ directory, sqliteBytes: readFileSync(name).length }));
