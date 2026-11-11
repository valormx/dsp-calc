/**
 * 传送带 / 分拣器等级与单条产线的物流容量计算。
 *
 * 数值来源：戴森球计划 BWIKI（wiki.biligame.com/dsp）
 *  - 传送带：6 / 12 / 30 个每秒；解锁「集装物流系统」后蓝带可 4 堆叠 → 120 个每秒。
 *  - 分拣器（1 格距离）：1.5 / 3 / 6 / 10 个货物每秒；集装分拣器可搬运 4 堆叠 → 40 个每秒。
 *
 * 计算口径（按实际布局：每种原料各一条进料带，出料单独一条带）：
 *   1. 单台设备每秒完成配方轮数 = 建筑倍率 / 配方时间(秒)，再按增产模式修正。
 *   2. 每条「物料流」= 一种原料的进料 或 一种产物的出料，各自独占一条传送带；
 *      该流单台每秒吞吐 = 配方中该物料数量 × 每秒轮数（出料再乘增产倍率）。
 *      同一物品若既是原料又是产物，也按两条独立的带分别计算，不合并。
 *   3. 每条流上每台设备固定配 1 个分拣器（1 格距离），不存在一条流配多个分拣器的情况：
 *      - 带速约束：N × 单台速率 ≤ 带速 → 该流最多串联 floor(带速 / 单台速率) 台。
 *      - 分拣器约束：单台速率 ≤ 分拣器速率；否则设备无法满速，必须升级分拣器等级。
 *   4. 整条产线的上限 = 各条流中最小的带上限，并单独注明瓶颈是哪条带。
 *   5. 分拣器可选「自动」：每行按自身工厂速率选推荐档（高一档余量），
 *      因为不同产线可能用不同等级的工厂，自动档按行计算而不改动全局设置。
 *
 * 注意：混带、多带并联、分拣器跨 2~3 格降速等情况不在估算范围内。
 */

// 单位统一为「个/秒」。stack 表示该等级下单个货物包裹可堆叠的物品数。
export const BELT_LEVELS = [
    {value: 1, name: '传送带 Mk.I', icon: '传送带', speed: 6, stack: 1},
    {value: 2, name: '高速传送带 Mk.II', icon: '高速传送带', speed: 12, stack: 1},
    {value: 3, name: '极速传送带 Mk.III', icon: '极速传送带', speed: 30, stack: 1},
    {value: 4, name: '极速传送带 · 4堆叠', icon: '极速传送带', speed: 120, stack: 4},
];

export const SORTER_LEVELS = [
    {value: 1, name: '分拣器 Mk.I', icon: '分拣器', speed: 1.5, stack: 1},
    {value: 2, name: '高速分拣器 Mk.II', icon: '高速分拣器', speed: 3, stack: 1},
    {value: 3, name: '极速分拣器 Mk.III', icon: '极速分拣器', speed: 6, stack: 1},
    {value: 4, name: '集装分拣器 · 4堆叠', icon: '集装分拣器', speed: 10, stack: 4},
];

export const DEFAULT_BELT_LEVEL = 3;
export const DEFAULT_SORTER_LEVEL = 3;

// value 0 = 自动：每条产线按自身工厂的物料速率匹配分拣器档位，并留一档余量。
// 因为不同产线可能用不同等级的工厂，自动档按行计算，不改动全局设置。
export const AUTO_SORTER_LEVEL = 0;
export const AUTO_SORTER = {
    value: AUTO_SORTER_LEVEL,
    name: '自动（按设备匹配）',
    icon: null,
    speed: 0,
    stack: 1,
    auto: true
};

export const BELT_OPTIONS = BELT_LEVELS.map(x => ({value: x.value, label: `${x.name} · ${x.speed}/s`}));
export const SORTER_OPTIONS = [
    {value: AUTO_SORTER_LEVEL, label: '自动 · 按设备等级匹配'},
    ...SORTER_LEVELS.map(x => ({
        value: x.value,
        label: `${x.name} · ${x.speed * x.stack}/s`
    }))
];

export function get_belt_level(value) {
    return BELT_LEVELS.find(x => x.value === Number(value)) || BELT_LEVELS[DEFAULT_BELT_LEVEL - 1];
}

export function get_sorter_level(value) {
    if (Number(value) === AUTO_SORTER_LEVEL) return AUTO_SORTER;
    return SORTER_LEVELS.find(x => x.value === Number(value)) || SORTER_LEVELS[DEFAULT_SORTER_LEVEL - 1];
}

/**
 * 计算一条产线在指定传送带 / 分拣器等级下的串联上限。
 *
 * @param {object} recipe       game_data.recipe_data 的配方（中文键：原料/产物/时间）
 * @param {object} factory_info game_data.factory_data[设施][建筑]（含「倍率」「名称」）
 * @param {object} scheme_recipe scheme_data.scheme_for_recipe[recipe_id]（增产模式/增产点数）
 * @param {object} game_data     含 proliferator_effect
 * @param {object} settings     含 acc_rate / inc_rate
 * @param {object} belt         BELT_LEVELS 中的一项
 * @param {object} sorter       SORTER_LEVELS 中的一项，或 AUTO_SORTER（按行自动匹配）
 * @returns {object|null} 计算结果；无配方或数据异常时返回 null
 */
export function compute_line_capacity(recipe, factory_info, scheme_recipe, game_data, settings, belt, sorter) {
    if (!recipe || !factory_info) return null;
    const recipe_time = Number(recipe['时间']);
    const building_speed = Number(factory_info['倍率']);
    if (!(recipe_time > 0) || !(building_speed > 0)) return null;

    const mode = Number(scheme_recipe?.['增产模式'] ?? 0);
    const pro_num = Number(scheme_recipe?.['增产点数'] ?? 0);
    const pro_effect = game_data?.proliferator_effect?.[pro_num] || {'加速效果': 1, '增产效果': 1};
    const acc_rate = Number(settings?.acc_rate ?? 1);
    const inc_rate = Number(settings?.inc_rate ?? 1);

    // 每秒完成的配方轮数；加速模式直接提高轮速，增产 / 透镜模式只提高产物数量。
    let cycles_per_sec = building_speed / recipe_time;
    let output_multiplier = 1;
    if (pro_num > 0) {
        if (mode === 1) {
            cycles_per_sec *= pro_effect['加速效果'] * acc_rate;
        } else if (mode === 2) {
            output_multiplier = pro_effect['增产效果'] * inc_rate;
        } else if (mode === 3) {
            // 射线接收站透镜喷涂：按加速效果计算额外产出
            output_multiplier = pro_effect['加速效果'] * acc_rate;
        }
        // 模式 4（分馏塔增产）按游戏内独立公式计算，此处保持保守估计。
    }

    // 每条物料流独占一条带：一种原料一条进料带，一种产物一条出料带。
    const flows = [];
    for (const [name, count] of Object.entries(recipe['原料'] || {})) {
        flows.push({name, kind: '进料', rate: Number(count) * cycles_per_sec});
    }
    for (const [name, count] of Object.entries(recipe['产物'] || {})) {
        flows.push({name, kind: '出料', rate: Number(count) * cycles_per_sec * output_multiplier});
    }
    if (flows.length === 0) return null;

    const belt_speed = belt.speed;

    // 能喂饱某条流的最低分拣器档位；连最高档都不够时返回最高档。
    function min_sorter_for(rate) {
        return SORTER_LEVELS.find(x => x.speed * x.stack >= rate - 1e-9)
            || SORTER_LEVELS[SORTER_LEVELS.length - 1];
    }

    for (const flow of flows) {
        flow.belt_limit = flow.rate > 0 ? Math.floor(belt_speed / flow.rate + 1e-9) : Infinity;
        flow.min_sorter = min_sorter_for(flow.rate);
    }

    let bottleneck = flows[0];
    let belt_limit = Infinity;
    for (const flow of flows) {
        if (flow.rate > bottleneck.rate) bottleneck = flow;
        if (flow.belt_limit < belt_limit) belt_limit = flow.belt_limit;
    }
    if (!(bottleneck.rate > 0) || !Number.isFinite(belt_limit)) return null;

    // 最低要求 = 所有流里要求最高的那一档；推荐档位再高一档，留出余量
    // （实践中 Mk.III 制造台不会只配刚好够用的分拣器，而是配极速分拣器）。
    const required_sorter = flows.reduce(
        (highest, f) => f.min_sorter.value > highest.value ? f.min_sorter : highest,
        SORTER_LEVELS[0]);
    const suggested_sorter = SORTER_LEVELS.find(x => x.value === required_sorter.value + 1)
        || required_sorter;

    // 自动档：本行按自身工厂速率采用推荐档位；手动档：使用全局选择的档位。
    const sorter_auto = !!sorter.auto;
    const effective_sorter = sorter_auto ? suggested_sorter : sorter;
    const sorter_speed = effective_sorter.speed * effective_sorter.stack;
    for (const flow of flows) {
        flow.sorter_ok = flow.rate <= sorter_speed + 1e-9;
    }
    const limiting_flows = flows.filter(f => !f.sorter_ok);

    return {
        factory_name: factory_info['名称'],
        belt_speed,
        sorter: effective_sorter,
        sorter_auto,
        sorter_speed,
        flows,
        input_belt_count: Object.keys(recipe['原料'] || {}).length,
        output_belt_count: Object.keys(recipe['产物'] || {}).length,
        max_rate: bottleneck.rate,
        bottleneck_item: bottleneck.name,
        bottleneck_kind: bottleneck.kind,
        cycles_per_sec,
        belt_limit,
        // 分拣器不足时设备无法满速，只能升级分拣器，不存在「一台配多个爪」的方案
        sorter_ok: limiting_flows.length === 0,
        limiting_flows,
        required_sorter,
        suggested_sorter,
    };
}
