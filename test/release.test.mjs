import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('release candidate keeps production boundaries and mandatory semantic editor gate',async()=>{
  const [pkg,docker,platform,app,index,server]=await Promise.all([
    read('package.json'),read('Dockerfile'),read('docs/platform.js'),read('docs/app.js'),read('docs/index.html'),read('src/server.mjs')
  ]);
  assert.equal(JSON.parse(pkg).version,'1.1.0-rc.1');
  assert.match(docker,/FROM node:24\.21\.0-alpine/);
  assert.match(docker,/RUN npm run build/);assert.match(docker,/COPY --from=test \/tmp\/rmdtxtml-qa-passed \/tmp\/rmdtxtml-qa-passed/);
  assert.doesNotMatch(platform,/rmdtxtml-api-v1/);
  assert.doesNotMatch(app,/Destino \(ID do chat\)|\bchatId\b|server:'settings'/);
  assert.doesNotMatch(index,/data-action="server"/);
  assert.match(index,/id="destination"/);
  assert.match(index,/app\.css\?v=1\.1\.0-rc\.1/);
  assert.match(index,/app\.js\?v=1\.1\.0-rc\.1/);
  assert.match(server,/\/api\/bootstrap/);
  assert.match(server,/input\.destinationId/);assert.match(app,/doc\.content\.model=core\.model\(\)/);
});
