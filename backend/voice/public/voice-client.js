export async function startTranscription({baseUrl='http://localhost:3001',onTranscript,onStatus=()=>{},onError=()=>{}}) {
  let stream, context, socket, recorder, source, timer, stopped=false, cleaned=false;
  const cleanup=async()=>{
    if(cleaned)return;cleaned=true;stream?.getTracks().forEach(t=>t.stop());source?.disconnect();recorder?.disconnect();
    if(context&&context.state!=='closed')await context.close();
  };
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    context=new AudioContext({sampleRate:16000});await context.resume();
    await context.audioWorklet.addModule(`${baseUrl}/pcm-worklet.js`);
    const url=new URL('/api/transcribe',baseUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{socket.close();reject(new Error('Cannot connect to voice backend.'));},10000);
      socket.onopen=()=>{clearTimeout(timeout);resolve();};socket.onerror=()=>{clearTimeout(timeout);reject(new Error('Cannot connect to voice backend.'));};
    });
    socket.onmessage=({data})=>{
      const event=JSON.parse(data);
      if(event.type==='transcript')onTranscript(event);
      if(event.type==='error'){clearTimeout(timer);onError(event.message);cleanup();}
      if(event.type==='done'){clearTimeout(timer);onStatus('done');cleanup();}
    };
    socket.onclose=()=>{clearTimeout(timer);cleanup();onStatus('closed');};socket.onerror=()=>{onError('Voice connection failed.');cleanup();};
    socket.send(JSON.stringify({type:'start',sampleRate:context.sampleRate}));
    source=context.createMediaStreamSource(stream);recorder=new AudioWorkletNode(context,'pcm-recorder');
    recorder.port.onmessage=({data})=>{
      if(socket.readyState!==WebSocket.OPEN)return;
      if(data.stopped){socket.send(JSON.stringify({type:'stop'}));cleanup();return;}
      if(socket.bufferedAmount>192000){onError('Audio connection is too slow. Try again.');socket.close();cleanup();return;}
      socket.send(data);
    };
    source.connect(recorder);recorder.connect(context.destination);onStatus('recording');
    return {
      stop(){if(stopped||cleaned)return;stopped=true;onStatus('finishing');recorder.port.postMessage('stop');timer=setTimeout(()=>{onError('Timed out waiting for final transcript.');socket.close();cleanup();},15000);},
      cancel(){clearTimeout(timer);socket.close();cleanup();}
    };
  }catch(error){socket?.close();await cleanup();throw error;}
}
export async function getPatientAudio(text,baseUrl='http://localhost:3001'){
  const response=await fetch(`${baseUrl}/api/speech`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(35000)});
  if(!response.ok)throw new Error((await response.json()).error||'Could not generate audio.');
  return response.blob();
}
