const client = {
  async apply(ctx) {
    // Task 2 迁入:注册 network-audit 开关、createNetworkAlertProvider、
    // createNetworkAuditProvider、/net-* 配置弹窗入口
  },
  dispose() {},
}
let _exports = null
try { _exports = (globalThis.__ModuleLoader__ || {}).load ? globalThis.__ModuleLoader__.load({ id: 'dsh-flash-net-mon/client', factory: () => client }) : client } catch (_) { _exports = client }
export default _exports
