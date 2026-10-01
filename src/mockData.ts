import type { LinkBoxFile } from './types';

export const mockFiles: LinkBoxFile[] = [
  { id:'video-1', name:'Sample Video.mkv', size:'1.4 GB', sizeBytes:1400000000, kind:'video', status:'downloading', progress:68, createdAt:new Date().toISOString() },
  { id:'folder-1', name:'Project Files', size:'2.8 GB', sizeBytes:2800000000, kind:'folder', status:'fetching', progress:24, subtitle:'12 files', createdAt:new Date(Date.now()-5*3600000).toISOString(), children:[
    { id:'f1', name:'video.mp4', size:'1.4 GB', sizeBytes:1400000000, kind:'video', status:'ready', createdAt:new Date().toISOString() },
    { id:'f2', name:'document.pdf', size:'12 MB', sizeBytes:12000000, kind:'pdf', status:'ready', createdAt:new Date().toISOString() },
    { id:'f3', name:'photos.zip', size:'800 MB', sizeBytes:800000000, kind:'archive', status:'ready', createdAt:new Date().toISOString() },
    { id:'f4', name:'notes.txt', size:'4 KB', sizeBytes:4000, kind:'text', status:'ready', createdAt:new Date().toISOString() },
    { id:'f5', name:'sheet.xlsx', size:'24 KB', sizeBytes:24000, kind:'sheet', status:'ready', createdAt:new Date().toISOString() },
    { id:'f6', name:'presentation.pptx', size:'12 MB', sizeBytes:12000000, kind:'presentation', status:'ready', createdAt:new Date().toISOString() },
    { id:'f7', name:'music.mp3', size:'18 MB', sizeBytes:18000000, kind:'audio', status:'ready', createdAt:new Date().toISOString() }
  ]},
  { id:'pdf-1', name:'User Guide.pdf', size:'24 MB', sizeBytes:24000000, kind:'pdf', status:'ready', createdAt:new Date().toISOString() },
  { id:'image-1', name:'Photo Collection', size:'600 MB', sizeBytes:600000000, kind:'image', status:'ready', createdAt:new Date().toISOString() },
  { id:'audio-1', name:'Audio Sample.mp3', size:'18 MB', sizeBytes:18000000, kind:'audio', status:'ready', createdAt:new Date().toISOString() }
];
