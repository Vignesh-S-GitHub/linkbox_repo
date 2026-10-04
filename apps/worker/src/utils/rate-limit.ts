import { ApiProblem } from "./magnet";
const requests=new Map<string,number>();
export function enforceSubmissionLimit(session:string,cooldownSeconds:number){const now=Date.now();const last=requests.get(session)??0;if(now-last<cooldownSeconds*1000)throw new ApiProblem(429,"submission_cooldown","Please wait a moment before adding another download.");requests.set(session,now);if(requests.size>10000){for(const [key,time] of requests){if(now-time>cooldownSeconds*1000)requests.delete(key);}}}
export function releaseFailedSubmission(session:string){requests.delete(session);}
