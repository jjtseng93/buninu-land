import {parentPort,workerData} from 'node:worker_threads';
if(workerData==='startup-exit')process.exit(7);
if(workerData==='startup-hang')setInterval(()=>{},1000);
else {
 parentPort.postMessage({ready:true});
 parentPort.on('message',()=>{
  if(workerData==='capture-exit')process.exit(7);
  if(workerData==='capture-error')throw Error('intentional worker failure');
  // capture-hang deliberately never replies.
 });
}
