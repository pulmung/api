import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../../user/domain/user';

@Injectable()
export class JwtTokenIssuer {
  constructor(private readonly jwt: JwtService) {}

  issue(user: User): string {
    return this.jwt.sign({ sub: user.id });
  }
}
