import { BrowserPool } from "../browser-management/classes/BrowserPool";
import logger from "../logger";
import { initializeRemoteBrowserForRecording, destroyRemoteBrowser, interpretWholeWorkflow, stopRunningInterpretation } from "../browser-management/controller";
import Run from "../models/Run";
import Robot from "../models/Robot";
import { BinaryOutputService } from "../storage/mino";
import { googleSheetUpdateTasks, processGoogleSheetUpdates } from "./integrations/gsheet";
import { airtableUpdateTasks, processAirtableUpdates } from "./integrations/airtable";

/**
 * 为PgBoss注册所有工作器
 * @param pgBoss PgBoss实例
 * @param browserPool 浏览器池实例
 */
export async function registerPgBossWorkers(pgBoss: any, browserPool: BrowserPool) {
  try {
    logger.log('info', 'Registering PgBoss workers...');
    
    // Worker for initializing browser recording
    await pgBoss.work('initialize-browser-recording', async (job: any) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;
        
        logger.log('info', `Starting browser initialization job for user: ${userId}`);
        const browserId = initializeRemoteBrowserForRecording(userId);
        logger.log('info', `Browser recording job completed with browserId: ${browserId}`);
        return { browserId };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Browser recording job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping a browser
    await pgBoss.work('destroy-browser', async (job: any) => {
      try {
        const data = extractJobData(job);
        const { browserId, userId } = data;
        
        logger.log('info', `Starting browser destruction job for browser: ${browserId}`);
        const success = await destroyRemoteBrowser(browserId, userId);
        logger.log('info', `Browser destruction job completed with result: ${success}`);
        return { success };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Destroy browser job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for interpreting workflow
    await pgBoss.work('interpret-workflow', async (job: any) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;

        logger.log('info', 'Starting workflow interpretation job');
        await interpretWholeWorkflow(userId);
        logger.log('info', 'Workflow interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Interpret workflow job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping workflow interpretation
    await pgBoss.work('stop-interpretation', async (job: any) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;

        logger.log('info', 'Starting stop interpretation job');
        await stopRunningInterpretation(userId);
        logger.log('info', 'Stop interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Stop interpretation job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for executing runs
    await registerRunExecutionWorker(pgBoss, browserPool);

    logger.log('info', 'All PgBoss workers registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to register PgBoss workers: ${errorMessage}`);
    throw error;
  }
}

/**
 * 注册运行执行工作器
 */
async function registerRunExecutionWorker(pgBoss: any, browserPool: BrowserPool) {
  try {
    const registeredUserQueues = new Map();

    // Worker for executing runs (Legacy)
    await pgBoss.work('execute-run', async (job: any) => {
      try {
        const singleJob = Array.isArray(job) ? job[0] : job;
        return await processRunExecution(singleJob, browserPool, pgBoss);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Run execution job failed: ${errorMessage}`);
        throw error;
      }
    });

    const checkForNewUserQueues = async () => {
      try {
        const activeQueues = await pgBoss.getQueues();
        
        const userQueues = activeQueues.filter((q: any) => q.name.startsWith('execute-run-user-'));
        
        for (const queue of userQueues) {
          if (!registeredUserQueues.has(queue.name)) {
            await pgBoss.work(queue.name, async (job: any) => {
              try {
                const singleJob = Array.isArray(job) ? job[0] : job;
                return await processRunExecution(singleJob, browserPool, pgBoss);
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.log('error', `Run execution job failed in ${queue.name}: ${errorMessage}`);
                throw error;
              }
            });
            
            registeredUserQueues.set(queue.name, true);
            logger.log('info', `Registered worker for queue: ${queue.name}`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Failed to check for new user queues: ${errorMessage}`);
      }
    };

    await checkForNewUserQueues();
    
    logger.log('info', 'Run execution worker registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to register run execution worker: ${errorMessage}`);
  }
}

/**
 * 从job中提取数据
 */
function extractJobData(job: any) {
  if (Array.isArray(job)) {
    if (job.length === 0) {
      throw new Error('Empty job array received');
    }
    return job[0].data;
  }
  return job.data;
}

/**
 * 为工作流添加生成标记
 */
function AddGeneratedFlags(workflow: any) {
  const copy = JSON.parse(JSON.stringify(workflow));
  for (let i = 0; i < workflow.workflow.length; i++) {
    copy.workflow[i].what.unshift({
      action: 'flag',
      args: ['generated'],
    });
  }
  return copy;
}

/**
 * 处理运行执行作业
 */
async function processRunExecution(job: any, browserPool: BrowserPool, pgBoss: any) {
  try {
    const data = job.data;
    logger.log('info', `Processing run execution job for runId: ${data.runId}, browserId: ${data.browserId}`);
    
    // Find the run
    const run = await Run.findOne({ where: { runId: data.runId } });
    if (!run) {
      logger.log('error', `Run ${data.runId} not found in database`);
      return { success: false };
    }

    const plainRun = run.toJSON();

    // Find the recording
    const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
    if (!recording) {
      logger.log('error', `Recording for run ${data.runId} not found`);
      
      // Update run status to failed
      await run.update({
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
        log: 'Failed: Recording not found',
      });
      
      // Check for queued runs even if this one failed
      await checkAndProcessQueuedRun(data.userId, data.browserId, browserPool, pgBoss);
      
      return { success: false };
    }

    // Get the browser and execute the run
    const browser = browserPool.getRemoteBrowser(plainRun.browserId);
    let currentPage = browser?.getCurrentPage();
    
    if (!browser || !currentPage) {
      logger.log('error', `Browser or page not available for run ${data.runId}`);
      
      await pgBoss.fail(job.id, "Failed to get browser or page for run");
      
      // Even if this run failed, check for queued runs
      await checkAndProcessQueuedRun(data.userId, data.browserId, browserPool, pgBoss);
      
      return { success: false };
    }

    try {
      // Reset the browser state before executing this run
      await resetBrowserState(browser);
      
      // Execute the workflow
      const workflow = AddGeneratedFlags(recording.recording);
      const interpretationInfo = await browser.interpreter.InterpretRecording(
        workflow, 
        currentPage, 
        (newPage: any) => currentPage = newPage, 
        plainRun.interpreterSettings
      );
      
      // Process the results
      const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
      const uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, interpretationInfo.binaryOutput);
      
      // Update the run record with results
      await run.update({
        status: 'success',
        finishedAt: new Date().toLocaleString(),
        browserId: plainRun.browserId,
        log: interpretationInfo.log.join('\n'),
        serializableOutput: interpretationInfo.serializableOutput,
        binaryOutput: uploadedBinaryOutput,
      });

      // Schedule updates for Google Sheets and Airtable
      try {
        googleSheetUpdateTasks[plainRun.runId] = {
          robotId: plainRun.robotMetaId,
          runId: plainRun.runId,
          status: 'pending',
          retries: 5,
        };

        airtableUpdateTasks[plainRun.runId] = {
          robotId: plainRun.robotMetaId,
          runId: plainRun.runId,
          status: 'pending',
          retries: 5,
        };

        processAirtableUpdates();
        processGoogleSheetUpdates();
      } catch (err) {
        logger.log('error', `Failed to update Google Sheet for run: ${plainRun.runId}: ${err.message}`);
      }
      
      // Check for and process queued runs before destroying the browser
      const queuedRunProcessed = await checkAndProcessQueuedRun(data.userId, plainRun.browserId, browserPool, pgBoss);
      
      // Only destroy the browser if no queued run was found
      if (!queuedRunProcessed) {
        await destroyRemoteBrowser(plainRun.browserId, data.userId);
        logger.log('info', `No queued runs found for browser ${plainRun.browserId}, browser destroyed`);
      }
      
      return { success: true };
    } catch (executionError) {
      logger.log('error', `Run execution failed for run ${data.runId}: ${executionError.message}`);
      
      await run.update({
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
        log: `Failed: ${executionError.message}`,
      });
      
      // Check for queued runs before destroying the browser
      const queuedRunProcessed = await checkAndProcessQueuedRun(data.userId, plainRun.browserId, browserPool, pgBoss);
      
      // Only destroy the browser if no queued run was found
      if (!queuedRunProcessed) {
        try {
          await destroyRemoteBrowser(plainRun.browserId, data.userId);
          logger.log('info', `No queued runs found for browser ${plainRun.browserId}, browser destroyed`);
        } catch (cleanupError) {
          logger.log('warn', `Failed to clean up browser for failed run ${data.runId}: ${cleanupError.message}`);
        }
      }
      
      return { success: false };
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to process run execution job: ${errorMessage}`);
    return { success: false };
  }
}

/**
 * 检查并处理队列中的下一个运行作业
 */
async function checkAndProcessQueuedRun(userId: string, browserId: string, browserPool: BrowserPool, pgBoss: any) {
  try {
    // Find the oldest queued run for this specific browser
    const queuedRun = await Run.findOne({
      where: {
        browserId: browserId,
        runByUserId: userId,
        status: 'queued'
      },
      order: [['startedAt', 'ASC']]
    });
    
    if (!queuedRun) {
      logger.log('info', `No queued runs found for browser ${browserId}`);
      return false;
    }
    
    // Reset the browser state before next run
    const browser = browserPool.getRemoteBrowser(browserId);
    if (browser) {
      logger.log('info', `Resetting browser state for browser ${browserId} before next run`);
      await resetBrowserState(browser);
    }
    
    // Update the queued run to running status
    await queuedRun.update({
      status: 'running',
      log: 'Run started - using browser from previous run'
    });
    
    // Use user-specific queue
    const userQueueName = `execute-run-user-${userId}`;
    
    // Schedule the run execution
    await pgBoss.createQueue(userQueueName);
    const executeJobId = await pgBoss.send(userQueueName, {
      userId: userId,
      runId: queuedRun.runId,
      browserId: browserId
    });
    
    logger.log('info', `Scheduled queued run ${queuedRun.runId} to use browser ${browserId}, job ID: ${executeJobId}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Error checking for queued runs: ${errorMessage}`);
    return false;
  }
}

/**
 * 重置浏览器状态
 */
async function resetBrowserState(browser: any) {
  try {
    const currentPage = browser.getCurrentPage();
    if (!currentPage) {
      logger.log('error', 'No current page available to reset browser state');
      return false;
    }
    
    // Navigate to blank page to reset state
    await currentPage.goto('about:blank');
    
    // Clear browser storage
    await currentPage.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        // Ignore errors in cleanup
      }
    });
    
    // Clear cookies
    const context = currentPage.context();
    await context.clearCookies();
    
    return true;
  } catch (error) {
    logger.log('error', `Failed to reset browser state`);
    return false;
  }
} 