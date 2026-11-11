/**
 * 传送带 / 分拣器等级与单条产线的物流容量计算。
 *
 * 数值来源：戴森球计划 BWIKI（wiki.biligame.com/dsp）
 *  - 传送带：6 / 12 / 30 个每秒；解锁「集装物流系统」后蓝带可 4 堆叠 → 120 个每秒。
 *  - 分拣器（1 格距离）：1.5 / 3 / 6 / 10 个货物每秒；集装分拣器可搬运 4 堆叠 → 40 个每秒。
 *
 * 计算口径（一条直线产线，主带送料/汇料，每台设备由分拣器取放料）：
 *   1. 单台设备每秒完成配方轮数 = 建筑倍率 / 配方时间(秒)，再按增产模式修正。
 *   2. 对配方的每种原料与产物算出「单台每秒吞吐」，取其中最大值作为瓶颈速率。
 *   3. 一条传送带最多串联台数 = floor(带速 / 瓶颈速率)，输入带与输出带按同一上限保守估计。
 *   4. 分拣器等级决定单台能否被喂饱：瓶颈速率 > 分拣器速率时，每台需要多个分拣器。
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

export const BELT_OPTIONS = BELT_LEVELS.map(x => ({value: x.value, label: `${x.name} · ${x.speed}/s`}));
export const SORTER_OPTIONS = SORTER_LEVELS.map(x => ({
    value: x.value,
    label: `${x.name} · ${x.speed * x.stack}/s`
}));

export function get_belt_level(value) {
    return BELT_LEVELS.find(x => x.value === Number(value)) || BELT_LEVELS[DEFAULT_BELT_LEVEL - 1];
}

export function get_sorter_level(value) {
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
 * @param {object} sorter       SORTER_LEVELS 中的一项
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

    // 每种物料在单台设备上的每秒吞吐（输入带与输出带分开考虑，取最紧的一路）。
    const rates = {};
    for (const [name, count] of Object.entries(recipe['原料'] || {})) {
        rates[name] = (rates[name] || 0) + Number(count) * cycles_per_sec;
    }
    for (const [name, count] of Object.entries(recipe['产物'] || {})) {
        rates[name] = (rates[name] || 0) + Number(count) * cycles_per_sec * output_multiplier;
    }

    let max_rate = 0;
    let bottleneck_item = '';
    for (const [name, rate] of Object.entries(rates)) {
        if (rate > max_rate) {
            max_rate = rate;
            bottleneck_item = name;
        }
    }
    if (!(max_rate > 0)) return null;

    const belt_speed = belt.speed;
    const sorter_speed = sorter.speed * sorter.stack;
    return {
        factory_name: factory_info['名称'],
        belt_speed,
        sorter_speed,
        max_rate,
        bottleneck_item,
        cycles_per_sec,
        belt_limit: Math.floor(belt_speed / max_rate + 1e-9),
        sorter_per_machine: Math.ceil(max_rate / sorter_speed - 1e-9),
        sorter_ok: max_rate <= sorter_speed + 1e-9,
    };
}
