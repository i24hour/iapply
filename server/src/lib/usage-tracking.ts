import { supabase } from './supabase.js';
import { calculateModelCost } from './model-pricing.js';

export type TaskSource = 'frontend' | 'extension' | 'telegram';

export interface TaskRunInput {
  userId: string;
  userEmail: string;
  source: TaskSource;
  channel: string;
  commandText: string;
  metadata?: Record<string, unknown>;
  agentSessionId?: string | null;
  status?: 'queued' | 'running' | 'completed' | 'stopped' | 'error';
}

export interface UsageEventInput {
  taskId?: string | null;
  userId: string;
  userEmail: string;
  source: TaskSource;
  channel: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number | null;
  metadata?: Record<string, unknown>;
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export async function createTaskRun(input: TaskRunInput) {
  try {
    const { data, error } = await supabase
      .from('task_runs')
      .insert({
        user_id: input.userId,
        user_email: input.userEmail,
        source: input.source,
        channel: input.channel,
        command_text: input.commandText,
        metadata: input.metadata || {},
        agent_session_id: input.agentSessionId || null,
        status: input.status || 'queued',
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create task run:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Unexpected task run creation error:', error);
    return null;
  }
}

export async function getTaskRunByAgentSession(agentSessionId: string) {
  const { data, error } = await supabase
    .from('task_runs')
    .select('*')
    .eq('agent_session_id', agentSessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to load task run by agent session:', error);
    return null;
  }

  return data;
}

export async function updateTaskRunStatus(taskId: string, userId: string, status: 'queued' | 'running' | 'completed' | 'stopped' | 'error') {
  try {
    const patch: Record<string, unknown> = {
      status,
      last_activity_at: new Date().toISOString(),
    };

    if (status === 'completed' || status === 'stopped' || status === 'error') {
      patch.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('task_runs')
      .update(patch)
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to update task run status:', error);
    }
  } catch (error) {
    console.error('Unexpected task status update error:', error);
  }
}

export async function stopOpenTasksForUser(userId: string) {
  try {
    const { error } = await supabase
      .from('task_runs')
      .update({
        status: 'stopped',
        completed_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('status', ['queued', 'running']);

    if (error) {
      console.error('Failed to stop open task runs:', error);
    }
  } catch (error) {
    console.error('Unexpected stop open tasks error:', error);
  }
}

export async function recordUsageEvent(input: UsageEventInput) {
  try {
    const inputTokens = Number(input.inputTokens || 0);
    const outputTokens = Number(input.outputTokens || 0);
    const totalTokens = Number(input.totalTokens || inputTokens + outputTokens);
    const pricing = calculateModelCost({
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
    });

    const { error: insertError } = await supabase
      .from('llm_usage_events')
      .insert({
        task_id: input.taskId || null,
        user_id: input.userId,
        user_email: input.userEmail,
        source: input.source,
        channel: input.channel,
        provider: pricing.provider,
        model: pricing.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        input_cost_usd: pricing.inputCostUsd,
        output_cost_usd: pricing.outputCostUsd,
        total_cost_usd: pricing.totalCostUsd,
        price_known: pricing.priceKnown,
        pricing_source: pricing.pricingSource,
        pricing_version: pricing.pricingVersion,
        metadata: input.metadata || {},
      });

    if (insertError) {
      console.error('Failed to insert LLM usage event:', insertError);
      return;
    }

    if (!input.taskId) return;

    const { data: taskRun, error: taskLoadError } = await supabase
      .from('task_runs')
      .select('prompt_tokens, completion_tokens, total_tokens, input_cost_usd, output_cost_usd, total_cost_usd, metadata')
      .eq('id', input.taskId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (taskLoadError || !taskRun) {
      if (taskLoadError) console.error('Failed to load task run for aggregation:', taskLoadError);
      return;
    }

    const mergedMetadata = {
      ...(taskRun.metadata || {}),
      last_provider: pricing.provider,
      last_model: pricing.model,
      price_known: pricing.priceKnown,
    };

    const { error: updateError } = await supabase
      .from('task_runs')
      .update({
        provider: pricing.provider,
        model: pricing.model,
        prompt_tokens: Number(taskRun.prompt_tokens || 0) + inputTokens,
        completion_tokens: Number(taskRun.completion_tokens || 0) + outputTokens,
        total_tokens: Number(taskRun.total_tokens || 0) + totalTokens,
        input_cost_usd: roundUsd(Number(taskRun.input_cost_usd || 0) + pricing.inputCostUsd),
        output_cost_usd: roundUsd(Number(taskRun.output_cost_usd || 0) + pricing.outputCostUsd),
        total_cost_usd: roundUsd(Number(taskRun.total_cost_usd || 0) + pricing.totalCostUsd),
        last_activity_at: new Date().toISOString(),
        metadata: mergedMetadata,
        status: 'running',
      })
      .eq('id', input.taskId)
      .eq('user_id', input.userId);

    if (updateError) {
      console.error('Failed to update aggregated task usage:', updateError);
    }
  } catch (error) {
    console.error('Unexpected LLM usage tracking error:', error);
  }
}
