export class ProcessDefaultClaimRoom implements IFlagProcesser {

    public primaryColor: ColorConstant = COLOR_WHITE;
    public secondaryColor: ColorConstant = COLOR_WHITE;

    constructor() {
        const self = this;
        self.processFlag = self.processFlag.bind(self);
    }

    /**
     * Process the default remote room flag
     * @param flag
     */
    public processFlag(flag: Flag): void {

    }
}
