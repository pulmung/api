import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtTokenIssuer {
  constructor(private readonly jwt: JwtService) {}

  issue(userId: string): string {
    return this.jwt.sign({ sub: userId });
  }
}
