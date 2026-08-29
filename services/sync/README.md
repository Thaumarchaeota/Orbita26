# orbita-sync

未来独立部署的 Linux API 服务。客户端各自保有本地数据库副本，本服务只处理版本化 API 的同步；不得共享 SQLite 文件或并发改写 Finance `.bean`。
