declare module 'pg-boss' {
  export interface Job<T = any> {
    id: string;
    name: string;
    data: T;
    state: string;
    output?: any;
  }
  
  export default class PgBoss {
    constructor(options: any);
    start(): Promise<void>;
    stop(): Promise<void>;
    send(queueName: string, data: any): Promise<string>;
    schedule(queueName: string, cronExpression: string, data: any, options?: any): Promise<string>;
    unschedule(jobName: string): Promise<boolean>;
    getSchedules(): Promise<any[]>;
    getJobById(queueName: string, jobId: string): Promise<Job | null>;
    work<T = any>(queueName: string, handler: (job: Job<T> | Job<T>[]) => Promise<any>): Promise<void>;
    createQueue(queueName: string): Promise<void>;
    on(event: string, handler: (payload: any) => void): void;
  }
} 