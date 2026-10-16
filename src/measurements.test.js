const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { WebSocket } = require('ws');
const attach = require('./measurements');
test('POST, push WebSocket, validation, bounded replay and authentication', async () => {
  const app=express(), server=require('http').createServer(app);
  attach(app,server,'test-key');
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const address=`127.0.0.1:${server.address().port}`;
  let ws;
  const connect=()=>new Promise((resolve,reject)=>{
    ws=new WebSocket(`ws://${address}/api/measurements/live`,{headers:{'X-Api-Key':'test-key'}});
    ws.once('message',data=>resolve(JSON.parse(data)));ws.once('error',reject);
  });
  const post=value=>fetch(`http://${address}/api/measurements`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})});
  try {
    const first=await connect();assert.equal(first.points.length,0);
    const pushed=new Promise(r=>ws.once('message',data=>r(JSON.parse(data))));
    assert.equal((await post(23.7)).status,201);
    const message=await pushed;assert.equal(message.points[0].value,23.7);assert.equal(message.session,first.session);
    assert.equal((await post('bad')).status,400);
    assert.equal((await post(null)).status,400);
    ws.terminate();
    for(let i=0;i<205;i++)assert.equal((await post(i)).status,201);
    const replay=await connect();assert.equal(replay.points.length,200);assert.equal(replay.points.at(-1).value,204);
    assert.equal(replay.points[0].id,7);
    await new Promise((resolve,reject)=>{
      const denied=new WebSocket(`ws://${address}/api/measurements/live`);
      denied.once('open',()=>reject(Error('Unauthenticated connection accepted')));
      denied.once('error',()=>resolve());
    });
  } finally {ws?.terminate();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
